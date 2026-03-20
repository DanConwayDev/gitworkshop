/**
 * git-grasp-pool — git HTTP protocol layer
 *
 * Wraps the low-level exports from @fiatjaf/git-natural-api to provide
 * cache-aware, CORS-proxy-aware, abort-signal-aware git operations.
 *
 * Every function accepts an already-resolved effective URL (proxy or direct).
 * The pool is responsible for choosing which URL to pass. This layer just
 * does the HTTP work and caching.
 *
 * Key difference from using the library's high-level functions directly:
 * - We never call the library's getInfoRefs — the pool owns that
 * - We pre-seed the library's capabilitiesCache after our own infoRefs fetch
 * - All HTTP goes through URLs the pool has already validated
 */

import {
  getInfoRefs as libGetInfoRefs,
  getCapabilities,
  fetchCommitsOnly as libFetchCommitsOnly,
  getDirectoryTreeAt as libGetDirectoryTreeAt,
  getObject as libGetObject,
  getObjectByPath as libGetObjectByPath,
  getSingleCommit as libGetSingleCommit,
  shallowCloneRepositoryAt as libShallowClone,
  type Commit,
  type Tree,
  type TreeEntry,
  type InfoRefsUploadPackResponse,
} from "@fiatjaf/git-natural-api";
import type { CorsProxyManager } from "./cors-proxy";
import type { GitObjectCache } from "./cache";
import type { ErrorClass } from "./types";

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Thrown when both direct and proxy attempts fail permanently.
 */
export class PermanentFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentFetchError";
  }
}

/**
 * Classify a fetch error to decide whether retrying is worthwhile.
 */
export function classifyFetchError(err: unknown): ErrorClass {
  if (err instanceof PermanentFetchError) return "permanent";
  if (
    err instanceof Response ||
    (err && typeof err === "object" && "status" in err)
  ) {
    const status = (err as { status: number }).status;
    if (status >= 400 && status < 500 && status !== 429) return "permanent";
    return "transient";
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
  )
    return "permanent";
  const statusMatch = msg.match(/\b([1-5]\d{2})\b/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    if (status >= 400 && status < 500 && status !== 429) return "permanent";
  }
  return "transient";
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
// GitHttpClient
// ---------------------------------------------------------------------------

/**
 * Encapsulates all git HTTP operations with integrated caching and CORS proxy.
 *
 * Each pool creates one GitHttpClient. The client uses the pool's cache and
 * CORS proxy manager but doesn't know about URL racing or winner selection —
 * it operates on a single URL at a time.
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

  /**
   * Pre-seed the library's capabilities cache for a URL.
   * Call this after a successful infoRefs fetch so that subsequent library
   * calls (getObject, fetchCommitsOnly, etc.) don't make their own
   * getInfoRefs request.
   */
  seedCapabilitiesCache(
    effectiveUrl: string,
    info: InfoRefsUploadPackResponse,
  ): void {
    // getCapabilities accepts an optional second arg that populates the cache
    getCapabilities(effectiveUrl, info);
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
        if (effectiveUrl === url) this.cors.markOriginDirect(url);
        this.cache.putInfoRefs(url, info);
        // Pre-seed the library's capabilities cache
        this.seedCapabilitiesCache(effectiveUrl, info);
        return info;
      } catch (err) {
        if (classifyFetchError(err) === "permanent") {
          const msg = err instanceof Error ? err.message : String(err);
          const permanent = new PermanentFetchError(
            `Permanent HTTP error for ${url}: ${msg}`,
          );
          this.permanentFailures.set(url, permanent);
          throw permanent;
        }
        // Already tried via proxy — both paths failed
        if (effectiveUrl !== url) {
          const msg = err instanceof Error ? err.message : String(err);
          const permanent = new PermanentFetchError(
            `Both direct and proxy fetch failed for ${url}: ${msg}`,
          );
          this.permanentFailures.set(url, permanent);
          throw permanent;
        }
        // Only attempt proxy fallback for CORS-like errors
        if (!this.cors.isCorsLikeError(err)) throw err;

        const proxyUrl = this.cors.toProxyUrl(url);
        try {
          const info = await libGetInfoRefs(proxyUrl);
          this.cors.markOriginNeedsProxy(url);
          this.cache.putInfoRefs(url, info);
          this.seedCapabilitiesCache(proxyUrl, info);
          return info;
        } catch (proxyErr) {
          const msg =
            proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
          const permanent = new PermanentFetchError(
            `Both direct and proxy fetch failed for ${url}: ${msg}`,
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
      // If not in text cache, try fetching via getObjectByPath
      if (!readmeContent) {
        for (const name of README_NAMES) {
          try {
            const entry = await libGetObjectByPath(
              effectiveUrl,
              commitHash,
              name,
            );
            if (signal.aborted) return null;
            if (!entry || entry.isDir) continue;
            const cached = await this.cache.getBlob(entry.hash);
            if (cached) {
              const text = new TextDecoder("utf-8").decode(cached);
              this.cache.putText(commitHash, name, text);
              readmeContent = text;
              readmeFilename = name;
              break;
            }
            const obj = await libGetObject(effectiveUrl, entry.hash);
            if (signal.aborted) return null;
            if (obj) {
              this.cache.putBlob(entry.hash, obj.data);
              const text = new TextDecoder("utf-8").decode(obj.data);
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

      if (supportsFilter) {
        const [commits, readmeResult] = await Promise.all([
          libFetchCommitsOnly(effectiveUrl, commitHash, 1),
          Promise.any(
            README_NAMES.map(async (name) => {
              const entry = await libGetObjectByPath(
                effectiveUrl,
                commitHash,
                name,
              );
              if (!entry || entry.isDir) throw new Error(`${name} not found`);
              const cachedBlob = await this.cache.getBlob(entry.hash);
              if (cachedBlob) {
                const text = new TextDecoder("utf-8").decode(cachedBlob);
                this.cache.putText(commitHash, name, text);
                return { name, content: text };
              }
              const obj = await libGetObject(effectiveUrl, entry.hash);
              if (!obj) throw new Error(`${name} blob missing`);
              this.cache.putBlob(entry.hash, obj.data);
              const text = new TextDecoder("utf-8").decode(obj.data);
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
        const result = await libShallowClone(effectiveUrl, commitHash);
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

    try {
      const commits = await libFetchCommitsOnly(
        effectiveUrl,
        commitHash,
        maxCommits,
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

    try {
      const tree = await libGetDirectoryTreeAt(
        effectiveUrl,
        commitHash,
        nestLimit,
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

    try {
      const obj = await libGetObject(effectiveUrl, blobHash);
      if (signal.aborted) return null;
      if (!obj) return null;
      this.cache.putBlob(blobHash, obj.data);
      return obj.data;
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

    try {
      const entry = await libGetObjectByPath(effectiveUrl, commitHash, path);
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
   * Fetch a single commit by hash or ref.
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

    try {
      const commit = await libGetSingleCommit(effectiveUrl, commitOrRef);
      if (signal.aborted) return null;
      this.cache.putCommit(commit);
      return commit;
    } catch {
      if (signal.aborted) return null;
      return null;
    }
  }
}
