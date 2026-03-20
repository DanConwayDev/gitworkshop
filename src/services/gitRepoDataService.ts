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
 *   If any ref declared in the state event differs from what was last fetched,
 *   AND the state event was published recently (within RECENT_STATE_EVENT_MAX_AGE_S),
 *   a re-fetch is scheduled with exponential backoff (starting at 2 s, doubling
 *   up to 5 min). The backoff resets on a successful fetch.
 *
 *   The recency guard prevents initial page-load from triggering backoff polling
 *   for historical state events that arrived before EOSE — we only want to poll
 *   when we believe a push just happened.
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
  peekCachedCommit,
  peekCachedInfoRefs,
} from "./gitObjectCache";
import {
  isCorsLikeError,
  toProxyUrl,
  markOriginDirect,
  markOriginNeedsProxy,
  resolveGitUrl,
} from "@/lib/corsProxy";

// ---------------------------------------------------------------------------
// Per-URL failure classification
// ---------------------------------------------------------------------------

/**
 * Classify a fetch error to decide whether retrying the same URL is worthwhile.
 *
 * - "permanent": the server definitively rejected the request (404, 410, etc.)
 *   or is unreachable at the network level.  No point retrying.
 * - "transient": server error (5xx), timeout, or other condition that may
 *   resolve on its own.  Retry is reasonable.
 */
function classifyFetchError(err: unknown): "permanent" | "transient" {
  if (
    err instanceof Response ||
    (err && typeof err === "object" && "status" in err)
  ) {
    const status = (err as { status: number }).status;
    // 4xx (except 429 Too Many Requests) are permanent — the resource doesn't exist
    if (status >= 400 && status < 500 && status !== 429) return "permanent";
    return "transient";
  }
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  // Network-level unreachable / CORS proxy also failed → permanent for this session
  if (
    /address.?unreachable|connection.?refused|err_failed|err_name_not_resolved/i.test(
      msg,
    )
  )
    return "permanent";
  // HTTP status embedded in message (isomorphic-git style: "HTTP Error: 404")
  const statusMatch = msg.match(/\b([1-5]\d{2})\b/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    if (status >= 400 && status < 500 && status !== 429) return "permanent";
  }
  return "transient";
}

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
      /** The clone URL of the git server that reported the newer commit. */
      gitServerUrl: string;
      stateCreatedAt: number;
      gitCommitterDate: number;
    };

export interface GitRepoData {
  loading: boolean;
  /**
   * True when stale data is being shown while a fresh git-server fetch is
   * still in flight (analogous to `git pull` in progress). Distinct from
   * `loading` which is true only when there is no data to show yet.
   */
  pulling: boolean;
  error: string | null;
  latestCommit: Commit | null;
  readmeContent: string | null;
  readmeFilename: string | null;
  /** The default branch name from the git server's HEAD symref */
  defaultBranch: string | null;
  urlInfoRefs: Record<string, UrlInfoRefsResult>;
  warning: GitRepoWarning | null;
  /**
   * Unix timestamp (seconds) of the last time a git-server fetch completed
   * successfully. `null` if no fetch has completed yet.
   */
  lastCheckedAt: number | null;
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

/**
 * A state event is considered "recent" (i.e. likely just pushed) if its
 * created_at is within this many seconds of now. Events older than this
 * arriving on initial page load (before EOSE) will not trigger backoff polling.
 */
const RECENT_STATE_EVENT_MAX_AGE_S = 5 * 60; // 5 minutes

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
 * Automatically falls back to the CORS proxy on CORS-like errors.
 * The cache key is always the original URL so callers stay unaware of the proxy.
 */
async function fetchInfoRefs(
  url: string,
  signal: AbortSignal,
): Promise<InfoRefsUploadPackResponse> {
  const cached = await getCachedInfoRefs(url);
  if (cached) return cached;
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const effectiveUrl = resolveGitUrl(url);
  try {
    const info = await getInfoRefs(effectiveUrl);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (effectiveUrl === url) markOriginDirect(url);
    cacheInfoRefs(url, info);
    return info;
  } catch (err) {
    // If we already tried via proxy (effectiveUrl !== url), propagate the error
    if (effectiveUrl !== url) throw err;
    // Only attempt proxy fallback for CORS-like errors
    if (!isCorsLikeError(err)) throw err;
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const proxyUrl = toProxyUrl(url);
    const info = await getInfoRefs(proxyUrl);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    markOriginNeedsProxy(url);
    cacheInfoRefs(url, info);
    return info;
  }
}

/**
 * Fetch commit metadata for a hash, checking the object cache first.
 * Falls back to shallowClone when the server lacks the filter capability.
 * Uses the CORS proxy automatically when the origin requires it.
 */
async function fetchCommitCached(
  url: string,
  commitHash: string,
  supportsFilter: boolean,
  signal: AbortSignal,
): Promise<CommitResult | null> {
  // Resolve the effective URL (may be proxy-prefixed)
  const effectiveUrl = resolveGitUrl(url);

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
          const entry = await getObjectByPath(effectiveUrl, commitHash, name);
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
          const obj = await getObject(effectiveUrl, entry.hash);
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
        fetchCommitsOnly(effectiveUrl, commitHash, 1),
        Promise.any(
          README_NAMES.map(async (name) => {
            const entry = await getObjectByPath(effectiveUrl, commitHash, name);
            if (!entry || entry.isDir) throw new Error(`${name} not found`);

            // Check blob cache first
            const cachedBlob = await getCachedBlob(entry.hash);
            if (cachedBlob) {
              const text = new TextDecoder("utf-8").decode(cachedBlob);
              cacheText(commitHash, name, text);
              return { name, content: text };
            }

            const obj = await getObject(effectiveUrl, entry.hash);
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
      const result = await shallowCloneRepositoryAt(effectiveUrl, commitHash);
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
  pulling: false,
  error: null,
  latestCommit: null,
  readmeContent: null,
  readmeFilename: null,
  defaultBranch: null,
  urlInfoRefs: {},
  warning: null,
  lastCheckedAt: null,
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
  /** The refs + stateCreatedAt from the latest onNewStateEvent call */
  private pendingHead: {
    commitId: string;
    refs: Record<string, string>;
    stateCreatedAt: number;
  } | null = null;
  /**
   * Snapshot of the ref map (refName → commitId) from the most recent
   * completed fetch. Used to detect when any ref changes, not just HEAD.
   */
  private lastFetchedRefs: Record<string, string> | undefined = undefined;
  /** Whether a fetch is currently in progress */
  private fetching = false;
  /** Whether at least one fetch has completed (successfully or not) */
  private fetchedOnce = false;
  /**
   * URLs that have permanently failed (404, network-unreachable, etc.) and
   * should not be retried within this session.  Reset only when the entry is
   * destroyed (page unload / eviction).
   */
  private permanentlyFailedUrls = new Set<string>();

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

    // Start fetching only if we haven't fetched yet and nothing is in flight.
    // If we already have a result (fetchedOnce), the subscriber gets the
    // current state above and we leave it alone — no re-fetch on tab switch.
    if (!this.fetchedOnce && !this.fetching && !this.backoffTimer) {
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
   *
   * Schedules a re-fetch with exponential backoff if:
   *   1. Any ref in the state event differs from what we last fetched, AND
   *   2. The state event was published recently (within RECENT_STATE_EVENT_MAX_AGE_S).
   *
   * The recency guard prevents initial page-load from triggering backoff
   * polling for historical state events that arrive before EOSE.
   *
   * @param headCommitId  - The HEAD commit declared by the state event
   * @param refs          - All refs declared by the state event (refName → commitId)
   * @param stateCreatedAt - Unix timestamp (seconds) of the state event
   */
  /**
   * Set pendingHead without triggering any fetch or backoff logic.
   * Used by subscribeToGitRepoData() to pre-seed the known head commit before
   * the first fetch starts, so runFetch() can use it in the fast-path cache
   * check. Only call this before subscribe() triggers startFetch().
   */
  setPendingHead(
    headCommitId: string,
    refs: Record<string, string>,
    stateCreatedAt: number,
  ) {
    this.pendingHead = { commitId: headCommitId, refs, stateCreatedAt };
  }

  onNewStateEvent(
    headCommitId: string,
    refs: Record<string, string>,
    stateCreatedAt: number,
  ) {
    const hadNoPendingHead = this.pendingHead === null;
    this.pendingHead = { commitId: headCommitId, refs, stateCreatedAt };

    // If a fetch is already in progress but we just learned the state commit
    // for the first time (pendingHead was null), abort it and restart so the
    // fast-path cache check runs with the now-known head commit. This handles
    // the common case where the initial fetch starts before the Nostr state
    // event arrives over the relay connection.
    if (this.fetching && hadNoPendingHead && !this.fetchedOnce) {
      this.startFetch();
      return;
    }

    // Only trigger backoff polling for recently-published state events.
    // Historical events arriving on initial load (before EOSE) should not
    // cause polling — the git server already has those commits.
    const nowS = Math.floor(Date.now() / 1000);
    if (nowS - stateCreatedAt > RECENT_STATE_EVENT_MAX_AGE_S) return;

    // If all refs match what we last fetched successfully, nothing to do
    if (this.refsMatchLastFetched(refs)) return;

    // If a fetch is already in progress, it will pick up pendingHead when done
    if (this.fetching) return;

    // Cancel any existing backoff timer and start a fresh one
    this.cancelBackoff();
    this.scheduleBackoffFetch();
  }

  /**
   * Returns true if every ref in `refs` matches the corresponding entry in
   * `lastFetchedRefs` (and no new refs have appeared). A missing
   * `lastFetchedRefs` means we haven't fetched yet — treat as not matching.
   */
  private refsMatchLastFetched(refs: Record<string, string>): boolean {
    if (!this.lastFetchedRefs) return false;
    const fetched = this.lastFetchedRefs;
    const incomingKeys = Object.keys(refs);
    const fetchedKeys = Object.keys(fetched);
    if (incomingKeys.length !== fetchedKeys.length) return false;
    return incomingKeys.every((k) => fetched[k] === refs[k]);
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

    // -----------------------------------------------------------------------
    // Fast-path: check the infoRefs cache (L1 memory first, then IDB) for
    // all URLs. If any URL has a fresh cached result whose HEAD differs from
    // the known state commit, we can immediately surface the warning and show
    // the git server's commit (if also cached) — no network round-trip needed.
    //
    // We check IDB here (not just L1 memory) so that the fast-path works on
    // page reload, when the L1 cache is empty but IDB still has fresh data.
    // -----------------------------------------------------------------------
    let cachedGitAheadResult: CommitResult | null = null;
    let cachedGitAheadCommit: string | null = null;
    if (knownHeadCommit) {
      for (const url of this.cloneUrls) {
        // Try L1 memory first (synchronous), then IDB (async)
        const cachedInfo =
          peekCachedInfoRefs(url) ?? (await getCachedInfoRefs(url));
        if (signal.aborted) {
          this.fetching = false;
          return;
        }
        if (!cachedInfo) continue;
        const headRef = cachedInfo.symrefs["HEAD"];
        const headCommit = headRef
          ? cachedInfo.refs[headRef]
          : Object.values(cachedInfo.refs)[0];
        if (!headCommit) continue;
        const matchesState =
          headCommit.startsWith(knownHeadCommit) ||
          knownHeadCommit.startsWith(headCommit);
        if (!matchesState) {
          // Git server is ahead — check if we also have the commit cached.
          // Try L1 memory first (synchronous), then IDB (async) so the
          // fast-path works on page reload when L1 is empty.
          const gitCommit =
            peekCachedCommit(headCommit) ?? (await getCachedCommit(headCommit));
          if (signal.aborted) {
            this.fetching = false;
            return;
          }
          if (gitCommit) {
            cachedGitAheadResult = {
              commit: gitCommit,
              readmeContent: getCachedText(headCommit, "README.md") ?? null,
              readmeFilename:
                getCachedText(headCommit, "README.md") !== undefined
                  ? "README.md"
                  : null,
              sourceUrl: url,
            };
          }
          cachedGitAheadCommit = headCommit;
          break;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Stale-while-revalidate: pre-populate from IDB cache before going to the
    // network. If we already have a cached commit for the known head, show it
    // immediately so the UI never blanks on refresh.
    //
    // Exception: if the cached infoRefs already tells us the git server is
    // ahead, skip showing the old signed commit and jump straight to showing
    // the git server's commit (with the warning) to avoid a visible flash.
    // -----------------------------------------------------------------------
    let hasCachedData = false;

    if (cachedGitAheadResult && stateCreatedAt !== undefined) {
      // We already know from the L1 infoRefs cache that the git server is
      // ahead. Show the git server's commit immediately with the warning so
      // the user never sees the old signed state flash in.
      // Use pulling:false so the banner is not suppressed — we're confident
      // in the cached result; the network fetch will confirm or update it.
      const gitCommitterDate =
        cachedGitAheadResult.commit.committer?.timestamp ??
        cachedGitAheadResult.commit.author.timestamp;
      this.setState((prev) => ({
        ...prev,
        loading: false,
        pulling: false,
        error: null,
        latestCommit: cachedGitAheadResult!.commit,
        readmeContent:
          cachedGitAheadResult!.readmeContent ?? prev.readmeContent,
        readmeFilename:
          cachedGitAheadResult!.readmeFilename ?? prev.readmeFilename,
        urlInfoRefs: {},
        warning: {
          kind: "state-behind-git",
          stateCommitId: knownHeadCommit!,
          gitCommitId: cachedGitAheadResult!.commit.hash,
          gitServerUrl: cachedGitAheadResult!.sourceUrl,
          stateCreatedAt,
          gitCommitterDate,
        },
      }));
      hasCachedData = true;
    } else if (cachedGitAheadCommit && stateCreatedAt !== undefined) {
      // Cached infoRefs shows git is ahead but the git commit itself isn't
      // cached yet. Show a loading state without the old signed commit to
      // avoid the flash — the network fetch will fill in the commit shortly.
      this.setState((prev) => ({
        ...prev,
        loading: true,
        pulling: false,
        error: null,
        latestCommit: null,
        readmeContent: null,
        readmeFilename: null,
        defaultBranch: null,
        urlInfoRefs: {},
        warning: null,
      }));
      hasCachedData = false; // treat as no cached data so we show loading
    } else if (knownHeadCommit) {
      const cachedCommit = peekCachedCommit(knownHeadCommit);
      if (cachedCommit) {
        // Commit is in the L1 memory cache — populate state immediately
        // without waiting for IDB or the network.
        const cachedText = getCachedText(knownHeadCommit, "README.md");
        this.setState((prev) => ({
          ...prev,
          loading: true,
          pulling: true, // stale data shown while fresh fetch is in flight
          error: null,
          latestCommit: cachedCommit,
          readmeContent: cachedText ?? prev.readmeContent,
          readmeFilename: cachedText ? "README.md" : prev.readmeFilename,
          urlInfoRefs: {},
          warning: null,
        }));
        hasCachedData = true;
      } else {
        // Try IDB asynchronously — this is a one-time cost per session
        const idbCommit = await getCachedCommit(knownHeadCommit);
        if (idbCommit && !signal.aborted) {
          const cachedText = getCachedText(knownHeadCommit, "README.md");
          this.setState((prev) => ({
            ...prev,
            loading: true,
            pulling: true, // stale data shown while fresh fetch is in flight
            error: null,
            latestCommit: idbCommit,
            readmeContent: cachedText ?? prev.readmeContent,
            readmeFilename: cachedText ? "README.md" : prev.readmeFilename,
            urlInfoRefs: {},
            warning: null,
          }));
          hasCachedData = true;
        }
      }
    }

    if (!hasCachedData && !cachedGitAheadCommit) {
      // Nothing cached — show a blank loading state (first visit or unknown head)
      this.setState((prev) => ({
        ...prev,
        loading: true,
        pulling: false,
        error: null,
        latestCommit: null,
        readmeContent: null,
        readmeFilename: null,
        defaultBranch: null,
        urlInfoRefs: {},
        warning: null,
      }));
    }

    if (signal.aborted) {
      this.fetching = false;
      return;
    }

    // -----------------------------------------------------------------------
    // Mutable display state
    // -----------------------------------------------------------------------
    let displayResult: CommitResult | null = null;
    let displayCommitterDate = 0;
    let stateCommitFetched = false;
    /**
     * True while the Phase 1 shortcut fetch of the known state commit is still
     * in flight. recomputeWarning() must not fire "state-commit-unavailable"
     * while this is true — the commit may still arrive and resolve the mismatch.
     */
    let stateCommitFetchPending = !!knownHeadCommit;
    /** True once all infoRefs fetches have settled (success or error). */
    let allInfoRefsSettled = false;
    let infoRefsSettled = 0;
    const urlInfoRefs: Record<string, UrlInfoRefsResult> = {};
    const fetchingCommits = new Set<string>();
    let anyGitHeadDiffersFromState = false;
    let bestGitResult: CommitResult | null = null;
    let defaultBranch: string | null = null;

    const recomputeWarning = () => {
      if (signal.aborted || !displayResult) return;

      const displayHash = displayResult.commit.hash;
      const displayCommitter =
        displayResult.commit.committer?.timestamp ??
        displayResult.commit.author.timestamp;

      if (
        knownHeadCommit &&
        !stateCommitFetched &&
        anyGitHeadDiffersFromState &&
        !stateCommitFetchPending
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
              gitServerUrl: displayResult!.sourceUrl,
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
                gitServerUrl: bestGitResult!.sourceUrl,
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

    /**
     * Update the displayed commit if `result` is newer than what's currently
     * shown, then recompute the warning. Never clears the warning directly —
     * recomputeWarning() decides whether a warning is appropriate based on the
     * full picture (bestGitResult, stateCommitFetched, etc.).
     */
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
          pulling: false,
          latestCommit: result.commit,
          readmeContent: result.readmeContent,
          readmeFilename: result.readmeFilename,
        }));
        recomputeWarning();
        return;
      }

      if (committerDate > displayCommitterDate) {
        displayResult = result;
        displayCommitterDate = committerDate;
        this.setState((prev) => ({
          ...prev,
          loading: false,
          pulling: false,
          latestCommit: result.commit,
          readmeContent: result.readmeContent ?? prev.readmeContent,
          readmeFilename: result.readmeFilename ?? prev.readmeFilename,
        }));
        recomputeWarning();
      }
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

    // Skip URLs that have permanently failed in a previous fetch cycle — there
    // is no reason to expect a different result (e.g. 404, unreachable host).
    const activeUrls = this.cloneUrls.filter(
      (url) => !this.permanentlyFailedUrls.has(url),
    );

    // -----------------------------------------------------------------------
    // Phase 1 shortcut: if we know the state HEAD, start fetching it now
    // -----------------------------------------------------------------------
    if (knownHeadCommit) {
      // Only try URLs where we have no cached infoRefs, or where the cached
      // infoRefs show the server has the known head commit.  Skipping URLs
      // whose cached infoRefs show a *different* HEAD avoids wasting requests
      // on servers that clearly don't have the signed commit (e.g. a server
      // that is ahead of the signed state, or one that is unreachable).
      const urlsLikelyHaveCommit = activeUrls.filter((url) => {
        const cached = peekCachedInfoRefs(url);
        if (!cached) return true; // unknown — worth trying
        const headRef = cached.symrefs["HEAD"];
        const headCommit = headRef
          ? cached.refs[headRef]
          : Object.values(cached.refs)[0];
        if (!headCommit) return true; // can't tell — worth trying
        return (
          headCommit.startsWith(knownHeadCommit) ||
          knownHeadCommit.startsWith(headCommit)
        );
      });

      Promise.any(
        urlsLikelyHaveCommit.map(async (url) => {
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
          stateCommitFetchPending = false;
          maybeUpdateDisplay(result, true);
          // If infoRefs already settled while we were fetching the state commit,
          // recomputeWarning() fired too early (with stateCommitFetchPending=true
          // suppressing it). Now that we have the result, run it again.
          if (allInfoRefsSettled) recomputeWarning();
        })
        .catch(() => {
          // State commit not found — surfaced as warning once infoRefs settle.
          stateCommitFetchPending = false;
          if (allInfoRefsSettled) recomputeWarning();
        });
    }

    // -----------------------------------------------------------------------
    // Phase 1: race getInfoRefs across all URLs concurrently
    // -----------------------------------------------------------------------
    const totalUrls = activeUrls.length;

    // If every URL has permanently failed, mark done immediately.
    if (totalUrls === 0) {
      this.fetching = false;
      this.fetchedOnce = true;
      if (!displayResult) {
        this.setState((prev) => ({
          ...prev,
          loading: false,
          pulling: false,
          error: "Could not reach any clone URL",
        }));
      } else {
        this.setState((prev) => ({ ...prev, loading: false, pulling: false }));
      }
      return;
    }

    for (const url of activeUrls) {
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
          // Mark permanently-failed URLs so we don't retry them on the next
          // backoff cycle.  Transient errors (5xx, timeout) are still retried.
          if (classifyFetchError(err) === "permanent") {
            this.permanentlyFailedUrls.add(url);
          }
        })
        .finally(() => {
          if (signal.aborted) return;
          infoRefsSettled++;
          if (infoRefsSettled === totalUrls) {
            allInfoRefsSettled = true;
            recomputeWarning();

            if (!displayResult) {
              this.setState((prev) => ({
                ...prev,
                loading: false,
                pulling: false,
                error: "Could not reach any clone URL",
              }));
            } else {
              this.setState((prev) => ({
                ...prev,
                loading: false,
                pulling: false,
              }));
            }

            // Fetch complete
            this.fetching = false;
            this.fetchedOnce = true;

            if (!signal.aborted && displayResult) {
              // Success — record the timestamp and full ref snapshot we fetched.
              const checkedAt = Math.floor(Date.now() / 1000);
              this.setState((prev) => ({ ...prev, lastCheckedAt: checkedAt }));

              // Build lastFetchedRefs from the infoRefs results so any ref change
              // (not just HEAD) will be detected on the next state event.
              const fetchedRefs: Record<string, string> = {};
              for (const result of Object.values(urlInfoRefs)) {
                if (result.status === "ok") {
                  for (const [refName, commitId] of Object.entries(
                    result.info.refs,
                  )) {
                    // Later URLs don't overwrite earlier ones — first-seen wins
                    if (!(refName in fetchedRefs)) {
                      fetchedRefs[refName] = commitId;
                    }
                  }
                }
              }
              this.lastFetchedRefs = fetchedRefs;

              // If a newer state event arrived while we were fetching, check
              // whether its refs still differ from what we just fetched.
              if (
                this.pendingHead &&
                !this.refsMatchLastFetched(this.pendingHead.refs)
              ) {
                // Refs don't match. Only retry if the signed state is *newer*
                // than what the git servers returned — i.e. we expect the
                // servers to catch up to a recent push.
                //
                // If any git server's HEAD is already *different* from the
                // signed state commit, the server is ahead (or diverged) and
                // retrying won't make the signed commit appear.  Give up and
                // wait for a new state event to trigger a fresh attempt.
                const signedCommit = this.pendingHead.commitId;
                const gitIsAhead = Object.values(urlInfoRefs).some((r) => {
                  if (r.status !== "ok") return false;
                  const headRef = r.info.symrefs["HEAD"];
                  const headCommit = headRef
                    ? r.info.refs[headRef]
                    : Object.values(r.info.refs)[0];
                  if (!headCommit) return false;
                  // Server has a commit that is NOT the signed commit
                  return (
                    !headCommit.startsWith(signedCommit) &&
                    !signedCommit.startsWith(headCommit)
                  );
                });
                if (!gitIsAhead) {
                  this.backoffDelay = Math.min(
                    this.backoffDelay * 2,
                    BACKOFF_MAX_MS,
                  );
                  this.scheduleBackoffFetch();
                } else {
                  // Git is ahead — reset backoff so the next genuine push
                  // starts fresh rather than with a long delay.
                  this.backoffDelay = BACKOFF_INITIAL_MS;
                }
              } else {
                // Refs match (or no pending state event) — reset backoff for
                // the next time a new state event triggers a re-fetch.
                this.backoffDelay = BACKOFF_INITIAL_MS;
              }
            } else if (!signal.aborted) {
              // All active URLs failed to return a usable result.
              // Only schedule a retry if a state event says the server should
              // have data we haven't seen yet AND there are still non-permanently-
              // failed URLs to try.  If every URL has been marked permanent, the
              // next runFetch() will bail out immediately with no network requests.
              const hasRetryableUrls = this.cloneUrls.some(
                (u) => !this.permanentlyFailedUrls.has(u),
              );
              if (this.pendingHead && hasRetryableUrls) {
                this.backoffDelay = Math.min(
                  this.backoffDelay * 2,
                  BACKOFF_MAX_MS,
                );
                this.scheduleBackoffFetch();
              }
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
 *
 * @param initialStateEvent - Optional Nostr state event info known at subscribe
 *   time. When provided, `pendingHead` is set before the first fetch starts so
 *   the fast-path cache check (peekCachedInfoRefs) can immediately detect a
 *   state-behind-git mismatch without waiting for a separate notifyNewStateEvent
 *   call. This eliminates the race where subscribe() starts a fetch before the
 *   hook's second useEffect fires notifyNewStateEvent().
 */
export function subscribeToGitRepoData(
  cloneUrls: string[],
  cb: Subscriber,
  initialStateEvent?: {
    headCommitId: string;
    refs: Record<string, string>;
    stateCreatedAt: number;
  },
): () => void {
  if (cloneUrls.length === 0) {
    cb({ ...INITIAL_STATE });
    return () => {};
  }
  const entry = getOrCreateEntry(cloneUrls);
  if (initialStateEvent) {
    // Set pendingHead before subscribe() triggers startFetch() so runFetch()
    // sees the known head commit on its very first run.
    entry.setPendingHead(
      initialStateEvent.headCommitId,
      initialStateEvent.refs,
      initialStateEvent.stateCreatedAt,
    );
  }
  return entry.subscribe(cb);
}

/**
 * Notify the service that a new Nostr state event has been observed for a
 * repository. If any ref declared in the state event differs from what was
 * last fetched AND the event is recent, a re-fetch will be scheduled with
 * exponential backoff.
 *
 * Safe to call even if no subscribers are currently active — the entry will
 * be created if needed (and will self-evict after TTL if nobody subscribes).
 *
 * @param cloneUrls     - Clone URLs identifying the repository entry
 * @param headCommitId  - The HEAD commit declared by the state event
 * @param refs          - All refs declared by the state event (refName → commitId)
 * @param stateCreatedAt - Unix timestamp (seconds) of the state event
 */
export function notifyNewStateEvent(
  cloneUrls: string[],
  headCommitId: string,
  refs: Record<string, string>,
  stateCreatedAt: number,
): void {
  if (cloneUrls.length === 0) return;
  const entry = getOrCreateEntry(cloneUrls);
  entry.onNewStateEvent(headCommitId, refs, stateCreatedAt);
}

/**
 * Get the current cached state for a set of clone URLs without subscribing.
 * Returns undefined if no entry exists in the registry.
 */
export function peekGitRepoData(cloneUrls: string[]): GitRepoData | undefined {
  const key = makeKey(cloneUrls);
  return registry.get(key)?.getState();
}
