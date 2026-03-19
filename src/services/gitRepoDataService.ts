/**
 * Git repository data service.
 *
 * Manages fetching and caching of per-repository git data (infoRefs, latest
 * commit, README) across the entire application lifetime. Multiple components
 * (e.g. About page, Code page) can subscribe to the same entry and share a
 * single in-flight fetch rather than each making independent network requests.
 *
 * Architecture
 * ============
 *
 * Registry
 *   A module-level Map<cacheKey, GitRepoDataEntry> where cacheKey is the
 *   sorted, joined clone URL list. One entry per unique set of clone URLs.
 *
 * GitRepoDataEntry
 *   Owns the full fetch lifecycle for one repository:
 *   - Races getInfoRefs across all clone URLs (with IDB cache)
 *   - Fetches commit metadata and README via gitObjectCache
 *   - Streams partial state updates to all subscribers as results arrive
 *   - Re-fetches with exponential backoff when a new Nostr state event
 *     declares a head commit not yet seen
 *   - Evicts itself from the registry after a TTL once all subscribers leave
 *
 * Subscribers
 *   Each useGitRepoData hook instance calls entry.subscribe(cb) which returns
 *   an unsubscribe function. The callback receives the full GitRepoData state
 *   snapshot on every update. Ref-counting ensures the fetch is only aborted
 *   when the last subscriber leaves.
 *
 * Nostr state event integration
 *   Callers notify the entry of new state events via entry.onNewStateEvent().
 *   If the declared head commit differs from what was last fetched, a re-fetch
 *   is scheduled with exponential backoff (starting at 2 s, doubling up to
 *   5 min). The backoff resets on a successful fetch.
 */

import {
  getInfoRefs,
  getObject,
  getObjectByPath,
  fetchCommitsOnly,
  shallowCloneRepositoryAt,
  type Commit,
  type InfoRefsUploadPackResponse,
} from "@fiatjaf/git-natural-api";
import {
  getCachedCommit,
  cacheCommit,
  getCachedBlob,
  cacheBlob,
  getCachedText,
  cacheText,
  getCachedInfoRefs,
  cacheInfoRefs,
} from "./gitObjectCache";

// ---------------------------------------------------------------------------
// Public types (re-exported for hook consumers)
// ---------------------------------------------------------------------------

export type UrlInfoRefsResult =
  | {
      status: "ok";
      headCommit: string;
      headRef: string | undefined;
      info: InfoRefsUploadPackResponse;
    }
  | { status: "error"; error: string };

export type GitRepoWarning =
  | { kind: "state-commit-unavailable"; stateCommitId: string }
  | {
      kind: "state-behind-git";
      stateCommitId: string;
      gitCommitId: string;
      stateCreatedAt: number;
      gitCommitterDate: number;
    };

export interface GitRepoData {
  loading: boolean;
  error: string | null;
  latestCommit: Commit | null;
  readmeContent: string | null;
  readmeFilename: string | null;
  /** The default branch name from the git server's HEAD symref */
  defaultBranch: string | null;
  urlInfoRefs: Record<string, UrlInfoRefsResult>;
  warning: GitRepoWarning | null;
}

// ---------------------------------------------------------------------------
// Constants
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

/** TTL (ms) to keep an entry alive after the last subscriber leaves. */
const SUBSCRIBER_TTL_MS = 60_000; // 1 minute

/** Backoff schedule (ms): 2s, 4s, 8s, … capped at 5 min */
const BACKOFF_INITIAL_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Internal commit result type
// ---------------------------------------------------------------------------

interface CommitResult {
  commit: Commit;
  readmeContent: string | null;
  readmeFilename: string | null;
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// Fetch helpers (cache-aware)
// ---------------------------------------------------------------------------

/**
 * Fetch infoRefs for a URL, checking the object cache first.
 */
async function fetchInfoRefs(
  url: string,
  signal: AbortSignal,
): Promise<InfoRefsUploadPackResponse> {
  const cached = await getCachedInfoRefs(url);
  if (cached) return cached;
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const info = await getInfoRefs(url);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  cacheInfoRefs(url, info);
  return info;
}

/**
 * Fetch commit metadata for a hash, checking the object cache first.
 * Falls back to shallowClone when the server lacks the filter capability.
 */
async function fetchCommitCached(
  url: string,
  commitHash: string,
  supportsFilter: boolean,
  signal: AbortSignal,
): Promise<CommitResult | null> {
  // Check commit cache first
  const cachedCommit = await getCachedCommit(commitHash);
  let commit: Commit | null = cachedCommit ?? null;

  let readmeContent: string | null = null;
  let readmeFilename: string | null = null;

  if (commit) {
    // Commit is cached — try to get README from text cache
    for (const name of README_NAMES) {
      const text = getCachedText(commitHash, name);
      if (text !== undefined) {
        readmeContent = text;
        readmeFilename = name;
        break;
      }
    }
    // If README not in text cache, try blob cache via getObjectByPath
    if (!readmeContent) {
      for (const name of README_NAMES) {
        try {
          const entry = await getObjectByPath(url, commitHash, name);
          if (signal.aborted) return null;
          if (!entry || entry.isDir) continue;
          const cached = await getCachedBlob(entry.hash);
          if (cached) {
            const text = new TextDecoder("utf-8").decode(cached);
            cacheText(commitHash, name, text);
            readmeContent = text;
            readmeFilename = name;
            break;
          }
          // Not in blob cache — fetch it
          const obj = await getObject(url, entry.hash);
          if (signal.aborted) return null;
          if (obj) {
            cacheBlob(entry.hash, obj.data);
            const text = new TextDecoder("utf-8").decode(obj.data);
            cacheText(commitHash, name, text);
            readmeContent = text;
            readmeFilename = name;
            break;
          }
        } catch {
          // Try next README name
        }
      }
    }
    return { commit, readmeContent, readmeFilename, sourceUrl: url };
  }

  // Commit not cached — fetch from git server
  try {
    if (supportsFilter) {
      const [commits, readmeResult] = await Promise.all([
        fetchCommitsOnly(url, commitHash, 1),
        Promise.any(
          README_NAMES.map(async (name) => {
            const entry = await getObjectByPath(url, commitHash, name);
            if (!entry || entry.isDir) throw new Error(`${name} not found`);

            // Check blob cache first
            const cachedBlob = await getCachedBlob(entry.hash);
            if (cachedBlob) {
              const text = new TextDecoder("utf-8").decode(cachedBlob);
              cacheText(commitHash, name, text);
              return { name, content: text };
            }

            const obj = await getObject(url, entry.hash);
            if (!obj) throw new Error(`${name} blob missing`);
            cacheBlob(entry.hash, obj.data);
            const text = new TextDecoder("utf-8").decode(obj.data);
            cacheText(commitHash, name, text);
            return { name, content: text };
          }),
        ).catch(() => null),
      ]);

      if (signal.aborted) return null;
      if (!commits || commits.length === 0) return null;

      commit = commits[0];
      cacheCommit(commit);
      readmeContent = readmeResult?.content ?? null;
      readmeFilename = readmeResult?.name ?? null;
    } else {
      const result = await shallowCloneRepositoryAt(url, commitHash);
      if (signal.aborted) return null;

      commit = result.commit;
      cacheCommit(commit);

      for (const name of README_NAMES) {
        const file = result.tree.files.find((f) => f.name === name);
        if (file?.content) {
          const text = new TextDecoder("utf-8").decode(file.content);
          cacheBlob(file.hash, file.content);
          cacheText(commitHash, name, text);
          readmeFilename = name;
          readmeContent = text;
          break;
        }
      }
    }

    return { commit, readmeContent, readmeFilename, sourceUrl: url };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GitRepoDataEntry
// ---------------------------------------------------------------------------

const INITIAL_STATE: GitRepoData = {
  loading: false,
  error: null,
  latestCommit: null,
  readmeContent: null,
  readmeFilename: null,
  defaultBranch: null,
  urlInfoRefs: {},
  warning: null,
};

type Subscriber = (state: GitRepoData) => void;

class GitRepoDataEntry {
  private cloneUrls: string[];
  private state: GitRepoData = { ...INITIAL_STATE };
  private subscribers = new Set<Subscriber>();
  private abort: AbortController | null = null;
  private evictTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffDelay = BACKOFF_INITIAL_MS;
  /** The knownHeadCommit + stateCreatedAt from the latest onNewStateEvent call */
  private pendingHead: { commitId: string; stateCreatedAt: number } | null =
    null;
  /** The head commit that was used for the most recent completed fetch */
  private lastFetchedHead: string | undefined = undefined;
  /** Whether a fetch is currently in progress */
  private fetching = false;

  constructor(cloneUrls: string[]) {
    this.cloneUrls = cloneUrls;
  }

  // -------------------------------------------------------------------------
  // Subscriber management
  // -------------------------------------------------------------------------

  subscribe(cb: Subscriber): () => void {
    // Cancel any pending eviction
    if (this.evictTimer !== null) {
      clearTimeout(this.evictTimer);
      this.evictTimer = null;
    }

    this.subscribers.add(cb);

    // Deliver current state immediately
    cb(this.state);

    // Start fetching if not already
    if (!this.fetching && !this.backoffTimer) {
      this.startFetch();
    }

    return () => {
      this.subscribers.delete(cb);
      if (this.subscribers.size === 0) {
        this.scheduleEviction();
      }
    };
  }

  private notify() {
    for (const cb of this.subscribers) {
      cb(this.state);
    }
  }

  private setState(updater: (prev: GitRepoData) => GitRepoData) {
    this.state = updater(this.state);
    this.notify();
  }

  // -------------------------------------------------------------------------
  // Nostr state event integration
  // -------------------------------------------------------------------------

  /**
   * Called when a new kind:30618 state event is observed.
   * If the declared head commit differs from what we last fetched, schedule
   * a re-fetch with exponential backoff (the git server may not have the new
   * commit yet immediately after a push).
   */
  onNewStateEvent(headCommitId: string, stateCreatedAt: number) {
    this.pendingHead = { commitId: headCommitId, stateCreatedAt };

    // If this is the same commit we already fetched successfully, nothing to do
    if (this.lastFetchedHead === headCommitId) return;

    // If a fetch is already in progress, it will pick up pendingHead when done
    if (this.fetching) return;

    // Cancel any existing backoff timer and start a fresh one
    this.cancelBackoff();
    this.scheduleBackoffFetch();
  }

  // -------------------------------------------------------------------------
  // Fetch lifecycle
  // -------------------------------------------------------------------------

  private startFetch() {
    this.cancelBackoff();
    this.runFetch();
  }

  private scheduleBackoffFetch() {
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      this.runFetch();
    }, this.backoffDelay);
  }

  private cancelBackoff() {
    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
  }

  private async runFetch() {
    if (this.cloneUrls.length === 0) return;

    // Abort any previous in-flight fetch
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const signal = abort.signal;

    this.fetching = true;

    const knownHeadCommit = this.pendingHead?.commitId;
    const stateCreatedAt = this.pendingHead?.stateCreatedAt;

    this.setState(() => ({
      loading: true,
      error: null,
      latestCommit: null,
      readmeContent: null,
      readmeFilename: null,
      defaultBranch: null,
      urlInfoRefs: {},
      warning: null,
    }));

    // -----------------------------------------------------------------------
    // Mutable display state
    // -----------------------------------------------------------------------
    let displayResult: CommitResult | null = null;
    let displayCommitterDate = 0;
    let stateCommitFetched = false;
    let infoRefsSettled = 0;
    const urlInfoRefs: Record<string, UrlInfoRefsResult> = {};
    const fetchingCommits = new Set<string>();
    let anyGitHeadDiffersFromState = false;
    let bestGitResult: CommitResult | null = null;
    let defaultBranch: string | null = null;

    const maybeUpdateDisplay = (
      result: CommitResult,
      isStateCommit: boolean,
    ) => {
      if (signal.aborted) return;

      const committerDate =
        result.commit.committer?.timestamp ?? result.commit.author.timestamp;

      if (isStateCommit) {
        stateCommitFetched = true;
      } else {
        if (
          !bestGitResult ||
          committerDate >
            (bestGitResult.commit.committer?.timestamp ??
              bestGitResult.commit.author.timestamp)
        ) {
          bestGitResult = result;
        }
      }

      if (!displayResult) {
        displayResult = result;
        displayCommitterDate = committerDate;
        this.setState((prev) => ({
          ...prev,
          loading: false,
          latestCommit: result.commit,
          readmeContent: result.readmeContent,
          readmeFilename: result.readmeFilename,
          warning: null,
        }));
        return;
      }

      if (committerDate > displayCommitterDate) {
        displayResult = result;
        displayCommitterDate = committerDate;
        this.setState((prev) => ({
          ...prev,
          loading: false,
          latestCommit: result.commit,
          readmeContent: result.readmeContent ?? prev.readmeContent,
          readmeFilename: result.readmeFilename ?? prev.readmeFilename,
          warning: null,
        }));
      }
    };

    const recomputeWarning = () => {
      if (signal.aborted || !displayResult) return;

      const displayHash = displayResult.commit.hash;
      const displayCommitter =
        displayResult.commit.committer?.timestamp ??
        displayResult.commit.author.timestamp;

      if (
        knownHeadCommit &&
        !stateCommitFetched &&
        anyGitHeadDiffersFromState
      ) {
        this.setState((prev) => ({
          ...prev,
          warning: {
            kind: "state-commit-unavailable",
            stateCommitId: knownHeadCommit,
          },
        }));
        return;
      }

      if (
        knownHeadCommit &&
        stateCreatedAt !== undefined &&
        bestGitResult &&
        anyGitHeadDiffersFromState
      ) {
        const gitCommitterDate =
          bestGitResult.commit.committer?.timestamp ??
          bestGitResult.commit.author.timestamp;

        if (
          !displayHash.startsWith(knownHeadCommit) &&
          !knownHeadCommit.startsWith(displayHash)
        ) {
          this.setState((prev) => ({
            ...prev,
            warning: {
              kind: "state-behind-git",
              stateCommitId: knownHeadCommit,
              gitCommitId: displayHash,
              stateCreatedAt: stateCreatedAt,
              gitCommitterDate: displayCommitter,
            },
          }));
          return;
        }

        if (gitCommitterDate > (stateCreatedAt ?? 0)) {
          const gitHash = bestGitResult.commit.hash;
          if (
            !gitHash.startsWith(knownHeadCommit) &&
            !knownHeadCommit.startsWith(gitHash)
          ) {
            this.setState((prev) => ({
              ...prev,
              warning: {
                kind: "state-behind-git",
                stateCommitId: knownHeadCommit,
                gitCommitId: gitHash,
                stateCreatedAt: stateCreatedAt,
                gitCommitterDate: gitCommitterDate,
              },
            }));
            return;
          }
        }
      }

      this.setState((prev) => ({ ...prev, warning: null }));
    };

    const fetchCommitIfNeeded = async (
      url: string,
      commitHash: string,
      supportsFilter: boolean,
      isStateCommit: boolean,
    ) => {
      if (fetchingCommits.has(commitHash)) return;
      fetchingCommits.add(commitHash);
      const result = await fetchCommitCached(
        url,
        commitHash,
        supportsFilter,
        signal,
      );
      if (signal.aborted || !result) return;
      maybeUpdateDisplay(result, isStateCommit);
    };

    // -----------------------------------------------------------------------
    // Phase 1 shortcut: if we know the state HEAD, start fetching it now
    // -----------------------------------------------------------------------
    if (knownHeadCommit) {
      Promise.any(
        this.cloneUrls.map(async (url) => {
          const result = await fetchCommitCached(
            url,
            knownHeadCommit,
            true,
            signal,
          );
          if (!result) throw new Error("not found");
          return result;
        }),
      )
        .then((result) => {
          if (signal.aborted) return;
          maybeUpdateDisplay(result, true);
        })
        .catch(() => {
          // State commit not found — surfaced as warning once infoRefs settle
        });
    }

    // -----------------------------------------------------------------------
    // Phase 1: race getInfoRefs across all URLs concurrently
    // -----------------------------------------------------------------------
    const totalUrls = this.cloneUrls.length;

    for (const url of this.cloneUrls) {
      fetchInfoRefs(url, signal)
        .then(async (info) => {
          if (signal.aborted) return;

          const headRef = info.symrefs["HEAD"];
          const headCommit = headRef
            ? info.refs[headRef]
            : Object.values(info.refs)[0];

          // Extract default branch name from HEAD symref
          if (headRef?.startsWith("refs/heads/") && !defaultBranch) {
            defaultBranch = headRef.replace("refs/heads/", "");
            this.setState((prev) => ({ ...prev, defaultBranch }));
          }

          const urlResult: UrlInfoRefsResult = {
            status: "ok",
            headCommit: headCommit ?? "",
            headRef,
            info,
          };
          urlInfoRefs[url] = urlResult;
          this.setState((prev) => ({
            ...prev,
            urlInfoRefs: { ...prev.urlInfoRefs, [url]: urlResult },
          }));

          if (!headCommit) return;

          const supportsFilter = info.capabilities.includes("filter");

          const matchesStateCommit =
            knownHeadCommit &&
            (headCommit.startsWith(knownHeadCommit) ||
              knownHeadCommit.startsWith(headCommit));

          if (!matchesStateCommit) {
            anyGitHeadDiffersFromState = true;
            await fetchCommitIfNeeded(url, headCommit, supportsFilter, false);
          } else if (!knownHeadCommit) {
            await fetchCommitIfNeeded(url, headCommit, supportsFilter, false);
          }
        })
        .catch((err: unknown) => {
          if (signal.aborted) return;
          const message = err instanceof Error ? err.message : String(err);
          urlInfoRefs[url] = { status: "error", error: message };
          this.setState((prev) => ({
            ...prev,
            urlInfoRefs: {
              ...prev.urlInfoRefs,
              [url]: { status: "error", error: message },
            },
          }));
        })
        .finally(() => {
          if (signal.aborted) return;
          infoRefsSettled++;
          if (infoRefsSettled === totalUrls) {
            recomputeWarning();

            if (!displayResult) {
              this.setState((prev) => ({
                ...prev,
                loading: false,
                error: "Could not reach any clone URL",
              }));
            } else {
              this.setState((prev) => ({ ...prev, loading: false }));
            }

            // Fetch complete
            this.fetching = false;

            if (!signal.aborted && displayResult) {
              // Success — record what we fetched and reset backoff
              this.lastFetchedHead = knownHeadCommit;
              this.backoffDelay = BACKOFF_INITIAL_MS;

              // If a newer state event arrived while we were fetching, schedule
              // a backoff re-fetch for it
              if (
                this.pendingHead &&
                this.pendingHead.commitId !== this.lastFetchedHead
              ) {
                this.scheduleBackoffFetch();
              }
            } else if (!signal.aborted) {
              // Failed — double the backoff and retry
              this.backoffDelay = Math.min(
                this.backoffDelay * 2,
                BACKOFF_MAX_MS,
              );
              this.scheduleBackoffFetch();
            }
          }
        });
    }
  }

  // -------------------------------------------------------------------------
  // Eviction
  // -------------------------------------------------------------------------

  private scheduleEviction() {
    this.evictTimer = setTimeout(() => {
      // Double-check no new subscribers arrived during the TTL
      if (this.subscribers.size === 0) {
        this.abort?.abort();
        this.cancelBackoff();
        registry.delete(makeKey(this.cloneUrls));
      }
    }, SUBSCRIBER_TTL_MS);
  }

  /** Immediately destroy this entry (called by registry.clear if needed). */
  destroy() {
    this.abort?.abort();
    this.cancelBackoff();
    if (this.evictTimer !== null) {
      clearTimeout(this.evictTimer);
      this.evictTimer = null;
    }
    this.subscribers.clear();
  }

  /** Current state snapshot (for initial delivery to new subscribers). */
  getState(): GitRepoData {
    return this.state;
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, GitRepoDataEntry>();

function makeKey(cloneUrls: string[]): string {
  // Sort so that different orderings of the same URLs map to the same entry
  return [...cloneUrls].sort().join("\n");
}

/**
 * Get or create a GitRepoDataEntry for the given clone URLs.
 */
function getOrCreateEntry(cloneUrls: string[]): GitRepoDataEntry {
  const key = makeKey(cloneUrls);
  let entry = registry.get(key);
  if (!entry) {
    entry = new GitRepoDataEntry(cloneUrls);
    registry.set(key, entry);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Subscribe to git repository data for the given clone URLs.
 *
 * Returns the current state immediately via the callback, then calls it again
 * on every update. Returns an unsubscribe function.
 *
 * Multiple callers with the same clone URLs share a single fetch.
 */
export function subscribeToGitRepoData(
  cloneUrls: string[],
  cb: Subscriber,
): () => void {
  if (cloneUrls.length === 0) {
    cb({ ...INITIAL_STATE });
    return () => {};
  }
  const entry = getOrCreateEntry(cloneUrls);
  return entry.subscribe(cb);
}

/**
 * Notify the service that a new Nostr state event has been observed for a
 * repository. If the declared head commit differs from what was last fetched,
 * a re-fetch will be scheduled with exponential backoff.
 *
 * Safe to call even if no subscribers are currently active — the entry will
 * be created if needed (and will self-evict after TTL if nobody subscribes).
 */
export function notifyNewStateEvent(
  cloneUrls: string[],
  headCommitId: string,
  stateCreatedAt: number,
): void {
  if (cloneUrls.length === 0) return;
  const entry = getOrCreateEntry(cloneUrls);
  entry.onNewStateEvent(headCommitId, stateCreatedAt);
}

/**
 * Get the current cached state for a set of clone URLs without subscribing.
 * Returns undefined if no entry exists in the registry.
 */
export function peekGitRepoData(cloneUrls: string[]): GitRepoData | undefined {
  const key = makeKey(cloneUrls);
  return registry.get(key)?.getState();
}
