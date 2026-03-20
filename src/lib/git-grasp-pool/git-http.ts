/**
 * git-grasp-pool — git HTTP protocol layer
 *
 * Uses only the low-level exports from @fiatjaf/git-natural-api:
 *   fetchPackfile, createWantRequest, loadTree, parseTree, parseCommit,
 *   getInfoRefs, MissingRef, ParsedObject
 *
 * We never call the library's high-level functions (getObject,
 * fetchCommitsOnly, getDirectoryTreeAt, etc.) because every one of them
 * calls getCapabilities() internally, which re-fetches infoRefs and
 * bypasses our cache entirely.
 *
 * Instead, we replicate the same capability-negotiation + packfile pattern
 * ourselves, passing the capabilities we already have from our cached
 * infoRefs response. This means zero extra HTTP requests for capabilities.
 *
 * Every function accepts an already-resolved effective URL (proxy or direct).
 * The pool is responsible for choosing which URL to pass.
 */

import {
  getInfoRefs as libGetInfoRefs,
  fetchPackfile,
  loadTree,
  parseCommit,
  type Commit,
  type Tree,
  type TreeEntry,
  type InfoRefsUploadPackResponse,
  type ParsedObject,
} from "@fiatjaf/git-natural-api";

// ---------------------------------------------------------------------------
// Vendored from @fiatjaf/git-natural-api/packs.ts (not exported by the package)
// createWantRequest builds the git smart-HTTP pkt-line want request body.
// ---------------------------------------------------------------------------

function pktEncode(data: string): string {
  if (data.length === 0) return "0000";
  const len = data.length + 4;
  return len.toString(16).padStart(4, "0") + data;
}

function createWantRequest(
  commitSha: string,
  capabilities: string[],
  deepen: number | undefined,
  filter?: string,
): string {
  if (commitSha.length !== 40)
    throw new Error(`invalid commit '${commitSha}', must be 40 char hex`);
  const pkts: string[] = [];
  pkts.push(`want ${commitSha} ${capabilities.join(" ")} agent=nsa/1.0.0\n`);
  if (typeof deepen !== "undefined") pkts.push(`deepen ${deepen}\n`);
  if (filter) pkts.push("filter " + filter + "\n");
  pkts.push("");
  pkts.push("done\n");
  return pkts.map(pktEncode).join("");
}
import type { CorsProxyManager } from "./cors-proxy";
import type { GitObjectCache } from "./cache";
import type { ErrorClass, UrlErrorKind } from "./types";

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Thrown when a fetch fails with a known, structured reason.
 * Carries a UrlErrorKind so the UI can render specific messages.
 */
export class GitFetchError extends Error {
  readonly kind: UrlErrorKind;
  readonly isPermanent: boolean;

  constructor(message: string, kind: UrlErrorKind, permanent = true) {
    super(message);
    this.name = "GitFetchError";
    this.kind = kind;
    this.isPermanent = permanent;
  }
}

/** @deprecated Use GitFetchError instead */
export class PermanentFetchError extends GitFetchError {
  constructor(message: string, kind: UrlErrorKind = "network") {
    super(message, kind, true);
    this.name = "PermanentFetchError";
  }
}

/**
 * Classify a fetch error to decide whether retrying is worthwhile.
 * Returns both the ErrorClass and the UrlErrorKind.
 */
export function classifyFetchError(err: unknown): {
  errorClass: ErrorClass;
  kind: UrlErrorKind;
} {
  if (err instanceof GitFetchError) {
    return {
      errorClass: err.isPermanent ? "permanent" : "transient",
      kind: err.kind,
    };
  }
  if (
    err instanceof Response ||
    (err && typeof err === "object" && "status" in err)
  ) {
    const status = (err as { status: number }).status;
    if (status >= 400 && status < 500 && status !== 429) {
      return { errorClass: "permanent", kind: "http-error" };
    }
    return { errorClass: "transient", kind: "transient" };
  }
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  if (
    /address.?unreachable|connection.?refused|err_failed|err_name_not_resolved/i.test(
      msg,
    )
  ) {
    return { errorClass: "permanent", kind: "network" };
  }
  const statusMatch = msg.match(/\b([1-5]\d{2})\b/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    if (status >= 400 && status < 500 && status !== 429) {
      return { errorClass: "permanent", kind: "http-error" };
    }
  }
  return { errorClass: "transient", kind: "transient" };
}

/**
 * Returns true if the URL uses a non-HTTP scheme (ssh://, git://, file://, etc.)
 * that cannot be fetched by the browser.
 */
export function isNonHttpUrl(url: string): boolean {
  try {
    const scheme = new URL(url).protocol;
    return scheme !== "http:" && scheme !== "https:";
  } catch {
    // Bare "git@github.com:..." SCP-style SSH URLs don't parse as URLs
    return url.includes("@") && url.includes(":");
  }
}

// ---------------------------------------------------------------------------
// README helpers
// ---------------------------------------------------------------------------

const README_NAMES = [
  "README.md",
  "readme.md",
  "README.markdown",
  "README",
  "readme",
  "README.txt",
  "readme.txt",
];

export { README_NAMES };

// ---------------------------------------------------------------------------
// Capability negotiation
//
// Mirrors the logic in git-natural-api/index.ts but operates on a
// capabilities array we already have — no extra HTTP request.
// ---------------------------------------------------------------------------

const NECESSARY_CAPS = ["multi_ack_detailed", "side-band-64k"];
const REQUIRED_CAPS = ["shallow", "object-format=sha1"];
const DEFAULT_CAPS = ["ofs-delta", "no-progress"];

/**
 * Select the capabilities to advertise in a want request, given the server's
 * capability list from infoRefs.
 *
 * Throws if a required capability is missing.
 */
function selectCapabilities(serverCaps: string[]): string[] {
  const caps: string[] = [];

  for (const cap of DEFAULT_CAPS) {
    if (serverCaps.includes(cap)) caps.push(cap);
  }
  for (const cap of NECESSARY_CAPS) {
    if (serverCaps.includes(cap)) caps.push(cap);
    else throw new Error(`git server missing required capability: ${cap}`);
  }
  for (const cap of REQUIRED_CAPS) {
    if (!serverCaps.includes(cap))
      throw new Error(`git server missing required capability: ${cap}`);
  }

  return caps;
}

// ---------------------------------------------------------------------------
// Low-level packfile helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a single object (blob/commit/tree) by its hash.
 * Uses the capabilities from the already-fetched infoRefs.
 */
async function fetchObject(
  effectiveUrl: string,
  hash: string,
  serverCaps: string[],
  signal: AbortSignal,
): Promise<ParsedObject | undefined> {
  if (signal.aborted) return undefined;
  const caps = selectCapabilities(serverCaps);
  const want = createWantRequest(hash, caps, 1);
  const result = await fetchPackfile(effectiveUrl, want);
  if (signal.aborted) return undefined;
  return result.objects.get(hash);
}

/**
 * Fetch commits only (tree:0 filter) up to maxCommits depth.
 * Requires the server to support "filter".
 */
async function fetchCommitsOnly(
  effectiveUrl: string,
  commitHash: string,
  maxCommits: number,
  serverCaps: string[],
  signal: AbortSignal,
): Promise<Commit[]> {
  if (signal.aborted) return [];
  const caps = selectCapabilities(serverCaps);
  if (!serverCaps.includes("filter"))
    throw new Error("git server does not support filter capability");
  caps.push("filter");
  const want = createWantRequest(commitHash, caps, maxCommits, "tree:0");
  const result = await fetchPackfile(effectiveUrl, want);
  if (signal.aborted) return [];
  const commits: Commit[] = [];
  for (const [hash, obj] of result.objects) {
    commits.push(parseCommit(obj.data, hash));
  }
  return commits;
}

/**
 * Fetch the directory tree at a commit (blob:none filter).
 * Requires the server to support "filter".
 */
async function fetchDirectoryTree(
  effectiveUrl: string,
  commitHash: string,
  nestLimit: number,
  serverCaps: string[],
  signal: AbortSignal,
): Promise<Tree> {
  if (signal.aborted) throw new Error("aborted");
  const caps = selectCapabilities(serverCaps);
  if (!serverCaps.includes("filter"))
    throw new Error("git server does not support filter capability");
  caps.push("filter");
  const want = createWantRequest(commitHash, caps, nestLimit, "blob:none");
  const result = await fetchPackfile(effectiveUrl, want);
  if (signal.aborted) throw new Error("aborted");

  const commitObj = result.objects.get(commitHash);
  if (!commitObj) throw new Error(`commit object not found: ${commitHash}`);

  const utf8 = new TextDecoder("utf-8");
  const rootTreeHash = utf8.decode(commitObj.data.slice(5, 45));
  const rootTreeObj = result.objects.get(rootTreeHash);
  if (!rootTreeObj) throw new Error(`root tree object not found`);

  return loadTree(rootTreeObj, result.objects, nestLimit);
}

/**
 * Shallow clone: fetch commit + full tree (no filter).
 * Fallback for servers that don't support "filter".
 */
async function shallowClone(
  effectiveUrl: string,
  commitHash: string,
  serverCaps: string[],
  signal: AbortSignal,
): Promise<{ commit: Commit; tree: Tree }> {
  if (signal.aborted) throw new Error("aborted");
  const caps = selectCapabilities(serverCaps);
  const want = createWantRequest(commitHash, caps, 1);
  const result = await fetchPackfile(effectiveUrl, want);
  if (signal.aborted) throw new Error("aborted");

  const commitObj = result.objects.get(commitHash);
  if (!commitObj) throw new Error(`commit object not found: ${commitHash}`);

  const commit = parseCommit(commitObj.data, commitHash);

  const utf8 = new TextDecoder("utf-8");
  const rootTreeHash = utf8.decode(commitObj.data.slice(5, 45));
  const rootTreeObj = result.objects.get(rootTreeHash);
  if (!rootTreeObj) throw new Error(`root tree object not found`);

  return { commit, tree: loadTree(rootTreeObj, result.objects) };
}

/**
 * Navigate a Tree to find an entry at the given path segments.
 * Returns the TreeEntry if found, undefined otherwise.
 */
function findInTree(tree: Tree, segments: string[]): TreeEntry | undefined {
  if (segments.length === 0) return undefined;
  const [head, ...rest] = segments;
  const isLast = rest.length === 0;

  for (const dir of tree.directories) {
    if (dir.name === head) {
      if (isLast)
        return { path: head, mode: "40000", isDir: true, hash: dir.hash };
      if (dir.content) return findInTree(dir.content, rest);
      return undefined;
    }
  }
  if (isLast) {
    for (const file of tree.files) {
      if (file.name === head)
        return { path: head, mode: "100644", isDir: false, hash: file.hash };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// GitHttpClient
// ---------------------------------------------------------------------------

/**
 * Encapsulates all git HTTP operations with integrated caching and CORS proxy.
 *
 * Each pool creates one GitHttpClient. The client uses the pool's cache and
 * CORS proxy manager but doesn't know about URL racing or winner selection —
 * it operates on a single URL at a time.
 *
 * All operations use only the low-level exports from git-natural-api so that
 * the library never makes its own infoRefs HTTP requests.
 */
export class GitHttpClient {
  private cache: GitObjectCache;
  private cors: CorsProxyManager;
  /**
   * In-flight dedup for infoRefs fetches. Prevents duplicate HTTP requests
   * when multiple callers request the same URL concurrently.
   */
  private inFlightInfoRefs = new Map<
    string,
    Promise<InfoRefsUploadPackResponse>
  >();
  /**
   * URLs whose infoRefs fetch permanently failed this session.
   * Checked synchronously to avoid any new HTTP request.
   */
  private permanentFailures = new Map<string, PermanentFetchError>();

  constructor(cache: GitObjectCache, cors: CorsProxyManager) {
    this.cache = cache;
    this.cors = cors;
  }

  /** Check if a URL has permanently failed */
  isPermanentlyFailed(url: string): boolean {
    return this.permanentFailures.has(url);
  }

  /** Filter out permanently failed URLs */
  filterLiveUrls(urls: string[]): string[] {
    return urls.filter((u) => !this.permanentFailures.has(u));
  }

  // -----------------------------------------------------------------------
  // InfoRefs
  // -----------------------------------------------------------------------

  /**
   * Fetch infoRefs for a URL with cache, dedup, CORS proxy fallback, and
   * permanent failure tracking.
   *
   * The cache key is always the original URL. The effective URL (possibly
   * proxy-prefixed) is used for the actual HTTP request.
   */
  fetchInfoRefs(
    url: string,
    signal: AbortSignal,
  ): Promise<InfoRefsUploadPackResponse> {
    // Fast-path: already known to be permanently unreachable
    const knownFailure = this.permanentFailures.get(url);
    if (knownFailure) return Promise.reject(knownFailure);

    // Reuse in-flight request
    const existing = this.inFlightInfoRefs.get(url);
    if (existing) {
      return existing.then((info) => {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        return info;
      });
    }

    const effectiveUrl = this.cors.resolveUrl(url);

    const fetchPromise: Promise<InfoRefsUploadPackResponse> = (async () => {
      // Check cache
      const cached = await this.cache.getInfoRefs(url);
      if (cached) return cached;

      try {
        const info = await libGetInfoRefs(effectiveUrl);
        // libGetInfoRefs does not check the HTTP status code — it calls
        // fetch().text() and parses the body as git pkt-line regardless of
        // status. A 404 HTML page produces an empty capabilities/refs object.
        // Treat that as a permanent failure so the URL is not retried.
        if (
          info.capabilities.length === 0 &&
          Object.keys(info.refs).length === 0
        ) {
          // If we went direct (no proxy), this is likely a 404 or wrong path
          const kind = effectiveUrl === url ? "not-git" : "proxy-error";
          const permanent = new GitFetchError(
            `No git data returned from ${url} (server may have returned a non-git response)`,
            kind,
          );
          this.permanentFailures.set(url, permanent);
          throw permanent;
        }
        if (effectiveUrl === url) this.cors.markOriginDirect(url);
        this.cache.putInfoRefs(url, info);
        return info;
      } catch (err) {
        if (err instanceof GitFetchError) throw err;
        const { errorClass, kind } = classifyFetchError(err);
        if (errorClass === "permanent") {
          const msg = err instanceof Error ? err.message : String(err);
          const permanent = new GitFetchError(
            `Permanent HTTP error for ${url}: ${msg}`,
            kind,
          );
          this.permanentFailures.set(url, permanent);
          throw permanent;
        }
        // Already tried via proxy — both paths failed
        if (effectiveUrl !== url) {
          const msg = err instanceof Error ? err.message : String(err);
          const permanent = new GitFetchError(
            `Both direct and proxy fetch failed for ${url}: ${msg}`,
            "cors-blocked",
          );
          this.permanentFailures.set(url, permanent);
          throw permanent;
        }
        // Only attempt proxy fallback for CORS-like errors
        if (!this.cors.isCorsLikeError(err)) throw err;

        const proxyUrl = this.cors.toProxyUrl(url);
        try {
          const info = await libGetInfoRefs(proxyUrl);
          // Same empty-response check for the proxy path.
          // Empty response via proxy = proxy reached the server but got a
          // non-git response (e.g. Cloudflare 523, nginx 502, etc.)
          if (
            info.capabilities.length === 0 &&
            Object.keys(info.refs).length === 0
          ) {
            const permanent = new GitFetchError(
              `No git data returned from ${url} via proxy (server may have returned a non-git response)`,
              "proxy-error",
            );
            this.permanentFailures.set(url, permanent);
            throw permanent;
          }
          this.cors.markOriginNeedsProxy(url);
          this.cache.putInfoRefs(url, info);
          return info;
        } catch (proxyErr) {
          if (proxyErr instanceof GitFetchError) throw proxyErr;
          const msg =
            proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
          const permanent = new GitFetchError(
            `Both direct and proxy fetch failed for ${url}: ${msg}`,
            "cors-blocked",
          );
          this.permanentFailures.set(url, permanent);
          throw permanent;
        }
      }
    })();

    this.inFlightInfoRefs.set(url, fetchPromise);
    fetchPromise.finally(() => this.inFlightInfoRefs.delete(url));

    return fetchPromise.then((info) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return info;
    });
  }

  // -----------------------------------------------------------------------
  // Private: capability resolution
  // -----------------------------------------------------------------------

  /**
   * Get server capabilities for a URL.
   *
   * Peeks the L1 cache first (zero cost when the pool has already fetched
   * infoRefs). Falls back to a full fetchInfoRefs call — which is itself
   * deduped and cached — for the case where fetchCommit is called concurrently
   * with the infoRefs race (e.g. fetchStateCommit).
   */
  private async getServerCaps(
    url: string,
    signal: AbortSignal,
  ): Promise<string[]> {
    const cached = this.cache.peekInfoRefs(url);
    if (cached) return cached.capabilities;
    const info = await this.fetchInfoRefs(url, signal);
    return info.capabilities;
  }

  // -----------------------------------------------------------------------
  // Commits
  // -----------------------------------------------------------------------

  /**
   * Fetch a single commit's metadata, checking cache first.
   * Returns the commit + optional README content.
   */
  async fetchCommit(
    url: string,
    commitHash: string,
    supportsFilter: boolean,
    signal: AbortSignal,
  ): Promise<{
    commit: Commit;
    readmeContent: string | null;
    readmeFilename: string | null;
  } | null> {
    const effectiveUrl = this.cors.resolveUrl(url);
    const serverCaps = await this.getServerCaps(url, signal);
    if (signal.aborted) return null;

    // Check commit cache
    const cachedCommit = await this.cache.getCommit(commitHash);
    if (cachedCommit) {
      // Try to get README from text cache
      let readmeContent: string | null = null;
      let readmeFilename: string | null = null;
      for (const name of README_NAMES) {
        const text = this.cache.getText(commitHash, name);
        if (text !== undefined) {
          readmeContent = text;
          readmeFilename = name;
          break;
        }
      }
      // If not in text cache, try fetching the blob directly
      if (!readmeContent && serverCaps.length > 0) {
        for (const name of README_NAMES) {
          try {
            const entry = await this.findObjectByPath(
              effectiveUrl,
              commitHash,
              name,
              serverCaps,
              signal,
            );
            if (signal.aborted) return null;
            if (!entry || entry.isDir) continue;
            const blobData = await this.fetchBlobByHash(
              effectiveUrl,
              entry.hash,
              serverCaps,
              signal,
            );
            if (signal.aborted) return null;
            if (blobData) {
              const text = new TextDecoder("utf-8").decode(blobData);
              this.cache.putText(commitHash, name, text);
              readmeContent = text;
              readmeFilename = name;
              break;
            }
          } catch {
            // Try next README name
          }
        }
      }
      return { commit: cachedCommit, readmeContent, readmeFilename };
    }

    // Commit not cached — fetch from git server
    if (signal.aborted) return null;

    try {
      let commit: Commit;
      let readmeContent: string | null = null;
      let readmeFilename: string | null = null;

      if (supportsFilter && serverCaps.length > 0) {
        const [commits, readmeResult] = await Promise.all([
          fetchCommitsOnly(effectiveUrl, commitHash, 1, serverCaps, signal),
          Promise.any(
            README_NAMES.map(async (name) => {
              const entry = await this.findObjectByPath(
                effectiveUrl,
                commitHash,
                name,
                serverCaps,
                signal,
              );
              if (!entry || entry.isDir) throw new Error(`${name} not found`);
              const cachedBlob = await this.cache.getBlob(entry.hash);
              if (cachedBlob) {
                const text = new TextDecoder("utf-8").decode(cachedBlob);
                this.cache.putText(commitHash, name, text);
                return { name, content: text };
              }
              const blobData = await this.fetchBlobByHash(
                effectiveUrl,
                entry.hash,
                serverCaps,
                signal,
              );
              if (!blobData) throw new Error(`${name} blob missing`);
              const text = new TextDecoder("utf-8").decode(blobData);
              this.cache.putText(commitHash, name, text);
              return { name, content: text };
            }),
          ).catch(() => null),
        ]);

        if (signal.aborted) return null;
        if (!commits || commits.length === 0) return null;

        commit = commits[0];
        readmeContent = readmeResult?.content ?? null;
        readmeFilename = readmeResult?.name ?? null;
      } else {
        // Fallback: shallow clone (no filter capability)
        const result = await shallowClone(
          effectiveUrl,
          commitHash,
          serverCaps,
          signal,
        );
        if (signal.aborted) return null;

        commit = result.commit;

        for (const name of README_NAMES) {
          const file = result.tree.files.find((f) => f.name === name);
          if (file?.content) {
            const text = new TextDecoder("utf-8").decode(file.content);
            this.cache.putBlob(file.hash, file.content);
            this.cache.putText(commitHash, name, text);
            readmeFilename = name;
            readmeContent = text;
            break;
          }
        }
      }

      this.cache.putCommit(commit);
      return { commit, readmeContent, readmeFilename };
    } catch {
      return null;
    }
  }

  /**
   * Fetch commit history for a ref, checking cache first.
   */
  async fetchCommitHistory(
    url: string,
    commitHash: string,
    maxCommits: number,
    signal: AbortSignal,
  ): Promise<Commit[] | null> {
    // Check cache
    const cached = await this.cache.getCommitHistory(commitHash, maxCommits);
    if (cached) return cached;

    const effectiveUrl = this.cors.resolveUrl(url);
    const serverCaps = await this.getServerCaps(url, signal);
    if (signal.aborted) return null;

    try {
      const commits = await fetchCommitsOnly(
        effectiveUrl,
        commitHash,
        maxCommits,
        serverCaps,
        signal,
      );
      if (signal.aborted) return null;

      // Cache each individual commit
      for (const commit of commits) {
        this.cache.putCommit(commit);
      }

      // Sort newest first
      const sorted = [...commits].sort(
        (a, b) =>
          (b.committer?.timestamp ?? b.author.timestamp) -
          (a.committer?.timestamp ?? a.author.timestamp),
      );

      this.cache.putCommitHistory(commitHash, maxCommits, sorted);
      return sorted;
    } catch {
      if (signal.aborted) return null;
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Trees
  // -----------------------------------------------------------------------

  /**
   * Fetch directory tree at a commit, checking cache first.
   */
  async fetchTree(
    url: string,
    commitHash: string,
    nestLimit: number,
    signal: AbortSignal,
  ): Promise<Tree | null> {
    const cached = await this.cache.getTree(commitHash, nestLimit);
    if (cached) return cached;

    const effectiveUrl = this.cors.resolveUrl(url);
    const serverCaps = await this.getServerCaps(url, signal);
    if (signal.aborted) return null;

    try {
      const tree = await fetchDirectoryTree(
        effectiveUrl,
        commitHash,
        nestLimit,
        serverCaps,
        signal,
      );
      if (signal.aborted) return null;
      this.cache.putTree(commitHash, nestLimit, tree);
      return tree;
    } catch {
      if (signal.aborted) return null;
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Blobs / objects
  // -----------------------------------------------------------------------

  /**
   * Fetch a blob by its object hash, checking cache first.
   */
  async fetchBlob(
    url: string,
    blobHash: string,
    signal: AbortSignal,
  ): Promise<Uint8Array | null> {
    const cached = await this.cache.getBlob(blobHash);
    if (cached) return cached;

    const effectiveUrl = this.cors.resolveUrl(url);
    const serverCaps = await this.getServerCaps(url, signal);
    if (signal.aborted) return null;

    try {
      const data = await this.fetchBlobByHash(
        effectiveUrl,
        blobHash,
        serverCaps,
        signal,
      );
      if (signal.aborted) return null;
      return data;
    } catch {
      if (signal.aborted) return null;
      return null;
    }
  }

  /**
   * Fetch an object by path within a commit, checking cache first.
   * Returns the tree entry metadata (hash, isDir) and optionally the blob data.
   */
  async fetchObjectByPath(
    url: string,
    commitHash: string,
    path: string,
    signal: AbortSignal,
  ): Promise<{ entry: TreeEntry; data: Uint8Array | null } | null> {
    const effectiveUrl = this.cors.resolveUrl(url);
    const serverCaps = await this.getServerCaps(url, signal);
    if (signal.aborted) return null;

    try {
      const entry = await this.findObjectByPath(
        effectiveUrl,
        commitHash,
        path,
        serverCaps,
        signal,
      );
      if (signal.aborted) return null;
      if (!entry) return null;

      if (entry.isDir) {
        return { entry, data: null };
      }

      // Fetch the blob
      const data = await this.fetchBlob(url, entry.hash, signal);
      if (signal.aborted) return null;
      return { entry, data };
    } catch {
      if (signal.aborted) return null;
      return null;
    }
  }

  /**
   * Fetch a single commit by hash.
   */
  async fetchSingleCommit(
    url: string,
    commitOrRef: string,
    signal: AbortSignal,
  ): Promise<Commit | null> {
    // Check cache first (only for commit hashes, not refs)
    if (/^[0-9a-f]{40}$/i.test(commitOrRef)) {
      const cached = await this.cache.getCommit(commitOrRef);
      if (cached) return cached;
    }

    const effectiveUrl = this.cors.resolveUrl(url);
    const serverCaps = await this.getServerCaps(url, signal);
    if (signal.aborted) return null;

    try {
      const commits = await fetchCommitsOnly(
        effectiveUrl,
        commitOrRef,
        1,
        serverCaps,
        signal,
      );
      if (signal.aborted) return null;
      if (commits.length === 0) return null;
      const commit = commits[0];
      this.cache.putCommit(commit);
      return commit;
    } catch {
      if (signal.aborted) return null;
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Fetch a blob by hash using the low-level packfile API.
   * Checks L1/L2 cache first, then fetches from the server.
   */
  private async fetchBlobByHash(
    effectiveUrl: string,
    hash: string,
    serverCaps: string[],
    signal: AbortSignal,
  ): Promise<Uint8Array | null> {
    const cached =
      this.cache.peekBlob(hash) ?? (await this.cache.getBlob(hash));
    if (cached) return cached;

    if (signal.aborted) return null;
    const obj = await fetchObject(effectiveUrl, hash, serverCaps, signal);
    if (signal.aborted) return null;
    if (!obj) return null;
    this.cache.putBlob(hash, obj.data);
    return obj.data;
  }

  /**
   * Find a tree entry by path within a commit.
   * Fetches the directory tree (blob:none) and navigates to the path.
   */
  private async findObjectByPath(
    effectiveUrl: string,
    commitHash: string,
    path: string,
    serverCaps: string[],
    signal: AbortSignal,
  ): Promise<TreeEntry | undefined> {
    const normalizedPath = path
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const segments = normalizedPath === "" ? [] : normalizedPath.split("/");
    if (segments.length === 0) return undefined;

    const nestLimit = segments.length;
    const tree = await fetchDirectoryTree(
      effectiveUrl,
      commitHash,
      nestLimit,
      serverCaps,
      signal,
    );
    if (signal.aborted) return undefined;

    return findInTree(tree, segments);
  }
}
