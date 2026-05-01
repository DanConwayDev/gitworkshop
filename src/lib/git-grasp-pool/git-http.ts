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

/**
 * Build a want+have upload-pack request body.
 *
 * Tells the server: "I want <wantSha>, and I already have <haveShas>, so
 * only send me the objects reachable from wantSha that aren't reachable
 * from any of the haveShas."
 *
 * An optional `deepen` bound caps how many commits back from `wantSha` the
 * server will include. It doubles as a safety net: if the server doesn't
 * recognise any of our haves, at least the response size is bounded.
 *
 * Every have in `haveShas` must already exist on the server — otherwise the
 * server will ignore them and include their reachable history in the pack.
 * Callers should derive haves from the server's infoRefs ref tips.
 *
 * The response is parsed by the patched `fetchPackfile` (see patches/) which
 * handles both the `NAK\n` and `ACK <sha>\n` negotiation terminators.
 */
function createWantHaveRequest(
  wantSha: string,
  haveShas: string[],
  capabilities: string[],
  deepen?: number,
): string {
  if (wantSha.length !== 40)
    throw new Error(`invalid commit '${wantSha}', must be 40 char hex`);
  for (const have of haveShas) {
    if (have.length !== 40)
      throw new Error(`invalid have '${have}', must be 40 char hex`);
  }
  const pkts: string[] = [];
  pkts.push(`want ${wantSha} ${capabilities.join(" ")} agent=nsa/1.0.0\n`);
  if (typeof deepen !== "undefined") pkts.push(`deepen ${deepen}\n`);
  // Flush after wants (required before haves).
  pkts.push("");
  for (const have of haveShas) {
    pkts.push(`have ${have}\n`);
  }
  pkts.push("done\n");
  return pkts.map(pktEncode).join("");
}
import type { CorsProxyManager } from "./cors-proxy";
import type { GitObjectCache, RawObjectsEntry } from "./cache";
import { FULL_NEST_LIMIT } from "./cache";
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
// BigBatchError detection
// ---------------------------------------------------------------------------

/**
 * The git-natural-api packfile decompressor throws a non-exported BigBatchError
 * when the packfile is too large to decompress in one pass.
 * Detect it by class name since it is not exported.
 */
function isBigBatchError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.constructor.name === "BigBatchError" ||
      err.message.includes("decompress too much data"))
  );
}

/** How many commits to request per batch when fetching commit history. */
const COMMIT_BATCH_SIZE = 15;

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
 *
 * Always passes deepen=1 to the server — fetching one commit's worth of tree
 * objects. The server sends ALL tree objects for that commit regardless of
 * this value; "deepen" only controls commit-graph ancestry traversal.
 *
 * @param parseDepth - How many directory levels to build in the returned Tree
 *                   structure. undefined = full recursive parse of everything
 *                   the server sent.
 *
 * Returns the parsed tree alongside the raw objects map and rootTreeHash so
 * callers can cache the raw objects for subsequent depth-only re-parses.
 */
async function fetchDirectoryTree(
  effectiveUrl: string,
  commitHash: string,
  serverCaps: string[],
  signal: AbortSignal,
  parseDepth?: number,
): Promise<{
  tree: Tree;
  rootTreeHash: string;
  rawObjects: Map<string, ParsedObject>;
}> {
  if (signal.aborted) throw new Error("aborted");
  const caps = selectCapabilities(serverCaps);
  if (!serverCaps.includes("filter"))
    throw new Error("git server does not support filter capability");
  caps.push("filter");
  // deepen=1: fetch only the tip commit. The server still sends ALL tree
  // objects for that commit, so parseDepth independently controls how much
  // of those objects loadTree() builds into the in-memory structure.
  const want = createWantRequest(commitHash, caps, 1, "blob:none");
  const result = await fetchPackfile(effectiveUrl, want);
  if (signal.aborted) throw new Error("aborted");

  const commitObj = result.objects.get(commitHash);
  if (!commitObj) throw new Error(`commit object not found: ${commitHash}`);

  const utf8 = new TextDecoder("utf-8");
  const rootTreeHash = utf8.decode(commitObj.data.slice(5, 45));
  const rootTreeObj = result.objects.get(rootTreeHash);
  if (!rootTreeObj) throw new Error(`root tree object not found`);

  // When parseDepth is undefined, loadTree recurses into every subtree object
  // the server sent — giving us the complete directory structure.
  const tree = loadTree(rootTreeObj, result.objects, parseDepth);
  return { tree, rootTreeHash, rawObjects: result.objects };
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
        return { path: head, mode: file.mode, isDir: false, hash: file.hash };
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
  /**
   * Commit hashes for which a background full-parse idle task has been
   * queued but not yet completed.  Prevents duplicate tasks.
   */
  private pendingBackgroundParse = new Set<string>();
  /**
   * In-flight dedup for blob:none packfile fetches, keyed by commitHash.
   *
   * On first load, fetchCommit launches up to 7 concurrent findObjectByPath
   * calls (one per README_NAMES candidate) via Promise.any.  Without dedup,
   * every one of them would independently issue an identical blob:none HTTP
   * request.  This map ensures only one request is in flight per commit at
   * any time; subsequent callers join the existing promise.
   *
   * The stored promise uses its own AbortController (never aborted) because
   * fetchPackfile does not honour AbortSignal anyway — the HTTP request always
   * runs to completion.  Individual callers check their own signal after the
   * shared promise resolves.
   */
  private inFlightRawObjects = new Map<string, Promise<RawObjectsEntry>>();

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
    untilHash?: string,
  ): Promise<Commit[] | null> {
    // Check cache
    const cached = await this.cache.getCommitHistory(commitHash, maxCommits);
    if (cached) return cached;

    const effectiveUrl = this.cors.resolveUrl(url);
    const serverCaps = await this.getServerCaps(url, signal);
    if (signal.aborted) return null;

    // Fetch in small batches starting from the tip. Each subsequent batch
    // starts from the oldest ancestor's first parent, so no commits are
    // re-downloaded. Stop as soon as we find the merge base (untilHash),
    // hit a root commit, or reach maxCommits.
    // On BigBatchError, halve the batch size and retry the same range.
    const allCommits: Commit[] = [];
    let nextWant = commitHash;
    let batchSize = Math.min(COMMIT_BATCH_SIZE, maxCommits);

    while (allCommits.length < maxCommits) {
      const remaining = maxCommits - allCommits.length;
      const thisDepth = Math.min(batchSize, remaining);

      try {
        const commits = await fetchCommitsOnly(
          effectiveUrl,
          nextWant,
          thisDepth,
          serverCaps,
          signal,
        );
        if (signal.aborted) return null;

        // Empty response on the first batch means the server doesn't have
        // this commit — return null so withFallback tries the next URL.
        if (commits.length === 0) {
          if (allCommits.length === 0) return null;
          break;
        }

        for (const commit of commits) this.cache.putCommit(commit);
        allCommits.push(...commits);

        // Stop if we found the merge base.
        if (untilHash && commits.some((c) => c.hash === untilHash)) break;

        // Find the oldest commit in this batch.
        const oldest = commits.reduce((a, b) =>
          (a.committer?.timestamp ?? a.author.timestamp) <
          (b.committer?.timestamp ?? b.author.timestamp)
            ? a
            : b,
        );

        // Stop if we hit a root commit or received fewer than requested
        // (means there are no more ancestors).
        if (oldest.parents.length === 0 || commits.length < thisDepth) break;

        // Next batch starts from the oldest commit's first parent.
        nextWant = oldest.parents[0];
      } catch (err) {
        if (signal.aborted) return null;
        if (!isBigBatchError(err)) {
          if (allCommits.length === 0) return null;
          break;
        }
        // BigBatchError: halve the batch size and retry the same range.
        if (batchSize <= 1) break;
        batchSize = Math.floor(batchSize / 2);
      }
    }

    if (allCommits.length === 0) return null;

    const sorted = [...allCommits].sort(
      (a, b) =>
        (b.committer?.timestamp ?? b.author.timestamp) -
        (a.committer?.timestamp ?? a.author.timestamp),
    );

    this.cache.putCommitHistory(commitHash, maxCommits, sorted);
    return sorted;
  }

  // -----------------------------------------------------------------------
  // Trees
  // -----------------------------------------------------------------------

  /**
   * Fetch directory tree at a commit, checking cache first.
   *
   * Cache hierarchy:
   *  1. Parsed tree cache (L1 + IDB) — check for any entry with nestLimit >=
   *     the requested depth; a deeper cached parse satisfies a shallower request.
   *  2. Raw objects cache (L1 only) — if we already have the packfile objects
   *     in memory from a previous fetch, re-parse at the new depth without any
   *     network request.
   *  3. Network fetch — always with deepen=1 (fetches one commit's tree objects).
   *     After fetching, raw objects are stashed in L1 so subsequent requests
   *     at any depth skip the network. A background idle task then does the
   *     full recursive parse and warms the parsed-tree cache at FULL_NEST_LIMIT.
   */
  async fetchTree(
    url: string,
    commitHash: string,
    nestLimit: number,
    signal: AbortSignal,
  ): Promise<Tree | null> {
    // 1. Parsed tree cache (L1 + IDB, with >= nestLimit check)
    const cached = await this.cache.getTree(commitHash, nestLimit);
    if (cached) return cached;

    // 2. Raw objects cache / in-flight dedup / network fetch (all via getRawObjects)
    const effectiveUrl = this.cors.resolveUrl(url);
    const serverCaps = await this.getServerCaps(url, signal);
    if (signal.aborted) return null;

    try {
      const rawEntry = await this.getRawObjects(
        effectiveUrl,
        commitHash,
        serverCaps,
        signal,
      );
      if (signal.aborted) return null;

      const rootObj = rawEntry.objects.get(rawEntry.rootTreeHash);
      if (!rootObj) return null;

      const tree = loadTree(rootObj, rawEntry.objects, nestLimit);
      this.cache.putTree(commitHash, nestLimit, tree);
      this.scheduleBackgroundFullParse(commitHash, rawEntry);
      return tree;
    } catch {
      if (signal.aborted) return null;
      return null;
    }
  }

  /**
   * Fetch the complete recursive directory tree at a commit for diff purposes,
   * and return the commit object alongside it.
   *
   * Uses deepen=1 (one commit, no ancestors) with blob:none (no file content).
   * The server sends ALL tree objects for that commit; we parse all of them
   * into a fully-recursive Tree structure. The commit object is present in the
   * same packfile response, so we parse and cache it here — eliminating the
   * need for a separate getSingleCommit network request.
   *
   * Cache: the tree is stored via cache.putFullTree(). The commit is stored
   * via cache.putCommit() so it is available to getSingleCommit callers too.
   */
  async fetchFullTree(
    url: string,
    commitHash: string,
    signal: AbortSignal,
  ): Promise<{ commit: Commit; tree: Tree } | null> {
    // Check both caches synchronously first
    const cachedTree = this.cache.peekFullTree(commitHash);
    const cachedCommit = this.cache.peekCommit(commitHash);
    if (cachedTree && cachedCommit)
      return { commit: cachedCommit, tree: cachedTree };

    // Async cache check
    const [asyncTree, asyncCommit] = await Promise.all([
      cachedTree
        ? Promise.resolve(cachedTree)
        : this.cache.getFullTree(commitHash),
      cachedCommit
        ? Promise.resolve(cachedCommit)
        : this.cache.getCommit(commitHash),
    ]);
    if (asyncTree && asyncCommit)
      return { commit: asyncCommit, tree: asyncTree };

    const effectiveUrl = this.cors.resolveUrl(url);
    const serverCaps = await this.getServerCaps(url, signal);
    if (signal.aborted) return null;

    try {
      const caps = selectCapabilities(serverCaps);
      if (!serverCaps.includes("filter"))
        throw new Error("git server does not support filter capability");
      caps.push("filter");

      // deepen=1: fetch only the tip commit (server still sends all its trees)
      // blob:none: no file content, only tree objects
      const want = createWantRequest(commitHash, caps, 1, "blob:none");
      const result = await fetchPackfile(effectiveUrl, want);
      if (signal.aborted) return null;

      const commitObj = result.objects.get(commitHash);
      if (!commitObj) throw new Error(`commit object not found: ${commitHash}`);

      // Parse the commit from the same packfile response — no extra request
      const commit = parseCommit(commitObj.data, commitHash);

      const utf8Decoder = new TextDecoder("utf-8");
      const rootTreeHash = utf8Decoder.decode(commitObj.data.slice(5, 45));
      const rootTreeObj = result.objects.get(rootTreeHash);
      if (!rootTreeObj) throw new Error(`root tree object not found`);

      // parseDepth=undefined: build the complete recursive Tree structure
      const tree = loadTree(rootTreeObj, result.objects, undefined);
      if (signal.aborted) return null;

      this.cache.putCommit(commit);
      this.cache.putFullTree(commitHash, tree);
      return { commit, tree };
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

  /**
   * Fetch the delta objects between a wanted commit and commits the caller
   * knows are already on the target push server.
   *
   * Asks the source `url` for `want <wantSha>` `have <haveShas>` with a
   * `deepen` bound as a hard safety cap. Returns the raw ParsedObject map of
   * everything the server sent — commits, trees and blobs needed for a
   * receive-pack connectivity check.
   *
   * Intended use: prepare the packfile for pushing a PR merge. `wantSha` is
   * the PR tip; `haveShas` is what the target grasp server already has —
   * normally `[defaultBranchHead]` since every eligible target has it, or
   * `[mergeBase]` as a fallback when the source does not know
   * defaultBranchHead. `deepen` bounds the fetch so a mis-specified have
   * cannot silently pull the full history.
   *
   * Returns `null` on error. The caller should count commits in the returned
   * map and decide whether the delta is small enough to push.
   */
  async fetchDeltaForPush(
    url: string,
    wantSha: string,
    haveShas: string[],
    deepen: number,
    signal: AbortSignal,
  ): Promise<Map<string, ParsedObject> | null> {
    if (signal.aborted) return null;
    const effectiveUrl = this.cors.resolveUrl(url);
    const serverCaps = await this.getServerCaps(url, signal);
    if (signal.aborted) return null;
    try {
      const caps = selectCapabilities(serverCaps);
      const request = createWantHaveRequest(wantSha, haveShas, caps, deepen);
      const result = await fetchPackfile(effectiveUrl, request);
      if (signal.aborted) return null;
      return result.objects;
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
   * Uses raw objects cache when available; falls back to a network fetch.
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

    // Raw objects cache / in-flight dedup / network fetch (all via getRawObjects)
    const rawEntry = await this.getRawObjects(
      effectiveUrl,
      commitHash,
      serverCaps,
      signal,
    );
    if (signal.aborted) return undefined;

    const rootObj = rawEntry.objects.get(rawEntry.rootTreeHash);
    if (!rootObj) return undefined;

    const tree = loadTree(rootObj, rawEntry.objects, nestLimit);
    this.scheduleBackgroundFullParse(commitHash, rawEntry);
    return findInTree(tree, segments);
  }

  /**
   * Get the raw blob:none packfile objects for a commit, with three tiers:
   *
   *  1. L1 raw objects cache — synchronous, zero cost.
   *  2. In-flight dedup — if a blob:none request for this commit is already
   *     in progress (e.g. several README name candidates from fetchCommit
   *     running concurrently), all callers share the single in-flight promise
   *     instead of each launching an identical HTTP request.
   *  3. Network fetch — fetchDirectoryTree with deepen=1 and a standalone
   *     AbortController that is never aborted.  fetchPackfile does not honour
   *     AbortSignal, so the request always runs to completion regardless; using
   *     a long-lived signal ensures the result is cached and shared even if the
   *     caller that initiated the fetch aborts before it finishes.
   *
   * Each caller checks its own signal after awaiting this method.
   */
  private getRawObjects(
    effectiveUrl: string,
    commitHash: string,
    serverCaps: string[],
    signal: AbortSignal,
  ): Promise<RawObjectsEntry> {
    // 1. L1 hit
    const cached = this.cache.peekRawObjects(commitHash);
    if (cached) return Promise.resolve(cached);

    // 2. Join in-flight request
    const inFlight = this.inFlightRawObjects.get(commitHash);
    if (inFlight) {
      return inFlight.then((entry) => {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        return entry;
      });
    }

    // 3. Start new fetch — tied to its own never-aborted signal
    if (signal.aborted)
      return Promise.reject(new DOMException("Aborted", "AbortError"));

    const fetchPromise = fetchDirectoryTree(
      effectiveUrl,
      commitHash,
      serverCaps,
      new AbortController().signal, // never aborted — see jsdoc above
      1, // parseDepth=1 for the initial tree; callers re-parse from raw objects
    )
      .then((result) => {
        const entry: RawObjectsEntry = {
          rootTreeHash: result.rootTreeHash,
          objects: result.rawObjects,
        };
        this.cache.putRawObjects(commitHash, entry);

        // The commit object is always present in the blob:none packfile
        // (it is the "want" object). Parsing and caching it here means
        // fetchCommit's getCommit() check returns a hit, eliminating the
        // parallel tree:0 (fetchCommitsOnly) request on initial load.
        if (!this.cache.peekCommit(commitHash)) {
          const commitObj = result.rawObjects.get(commitHash);
          if (commitObj) {
            try {
              this.cache.putCommit(parseCommit(commitObj.data, commitHash));
            } catch {
              // parseCommit failure is non-fatal — fetchCommit will retry
            }
          }
        }

        return entry;
      })
      .finally(() => {
        this.inFlightRawObjects.delete(commitHash);
      });

    this.inFlightRawObjects.set(commitHash, fetchPromise);
    return fetchPromise.then((entry) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return entry;
    });
  }

  /**
   * Schedule a background idle task to fully parse all tree objects for a
   * commit and warm the parsed-tree cache at FULL_NEST_LIMIT.
   *
   * This means that after the first (shallow) render, subsequent navigations
   * to any depth within the same commit skip both the network and the re-parse.
   *
   * Uses requestIdleCallback when available; falls back to setTimeout(0).
   * Deduplicates: at most one pending task per commitHash.
   */
  private scheduleBackgroundFullParse(
    commitHash: string,
    rawEntry: RawObjectsEntry,
  ): void {
    // Already have a full parse cached or scheduled
    if (this.cache.peekTree(commitHash, FULL_NEST_LIMIT)) return;
    if (this.pendingBackgroundParse.has(commitHash)) return;

    this.pendingBackgroundParse.add(commitHash);

    const run = () => {
      this.pendingBackgroundParse.delete(commitHash);
      // Double-check after idle — another path may have populated the cache
      if (this.cache.peekTree(commitHash, FULL_NEST_LIMIT)) return;
      const rootObj = rawEntry.objects.get(rawEntry.rootTreeHash);
      if (!rootObj) return;
      // parseDepth=undefined → fully recursive parse of all objects the server sent
      const fullTree = loadTree(rootObj, rawEntry.objects, undefined);
      this.cache.putTree(commitHash, FULL_NEST_LIMIT, fullTree);
    };

    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(run);
    } else {
      setTimeout(run, 0);
    }
  }
}
