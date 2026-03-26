/**
 * git-grasp-pool — GitGraspPool
 *
 * The single abstraction through which all git HTTP operations flow for a
 * given repository. Replaces the pattern where every hook and component
 * independently does Promise.any(cloneUrls.map(...)) fan-outs.
 *
 * Responsibilities:
 * - Own the URL racing strategy (race infoRefs, pick winner, fallback)
 * - Track per-URL state (connection status, latency, capabilities)
 * - Encapsulate CORS proxy logic
 * - Encapsulate the IDB/memory cache layer
 * - Expose observable state for UI
 * - Provide a simple API for consumers (getTree, getBlob, getCommitHistory, etc.)
 * - Accept new clone URLs dynamically (as announcement events arrive)
 * - Integrate with Nostr state events (backoff re-fetch, warning computation)
 */

import { BehaviorSubject, Subscription } from "rxjs";
import type { Observable } from "rxjs";
import type {
  PoolState,
  PoolHealth,
  PoolOptions,
  PoolSubscriber,
  PoolWarning,
  RefDiscrepancy,
  UrlRefStatus,
  StateEventInput,
  Commit,
  Tree,
  CommitRangeData,
  InfoRefsUploadPackResponse,
} from "./types";
import { CorsProxyManager } from "./cors-proxy";
import { GitObjectCache } from "./cache";
import { GitHttpClient, classifyFetchError, isNonHttpUrl } from "./git-http";
import { UrlStateManager, UrlTracker } from "./url-state";
import { StateEventManager } from "./state-event";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EVICTION_GRACE_MS = 60_000;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function makeInitialState(): PoolState {
  return {
    urls: {},
    winnerUrl: null,
    health: "idle",
    loading: false,
    pulling: false,
    latestCommit: null,
    readmeContent: null,
    readmeFilename: null,
    defaultBranch: null,
    warning: null,
    error: null,
    lastCheckedAt: null,
    crossRefDiscrepancies: [],
    retryAt: null,
  };
}

// ---------------------------------------------------------------------------
// Ref status computation helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether two commit hashes are equivalent (one may be a prefix
 * of the other when abbreviated hashes are involved).
 */
function commitsMatch(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Compute per-URL, per-ref sync status and cross-ref discrepancies.
 *
 * For each ref that appears in at least one server's infoRefs:
 *   - If a state event exists: compare each server's commit against the
 *     state event's commit for that ref.
 *   - If no state event: compare each server's commit against the majority
 *     (first server that reported the ref).
 *
 * Returns:
 *   - `urlRefStatuses`: map of url → { refName → UrlRefStatus }
 *   - `urlRefCommits`:  map of url → { refName → commitHash }
 *   - `crossRefDiscrepancies`: refs where servers disagree
 */
function computeRefStatuses(
  trackers: UrlTracker[],
  stateEvent: StateEventInput,
  stateEose: boolean,
): {
  urlRefStatuses: Map<string, Record<string, UrlRefStatus>>;
  urlRefCommits: Map<string, Record<string, string>>;
  crossRefDiscrepancies: RefDiscrepancy[];
} {
  const urlRefStatuses = new Map<string, Record<string, UrlRefStatus>>();
  const urlRefCommits = new Map<string, Record<string, string>>();

  // Initialise maps for all trackers
  for (const t of trackers) {
    urlRefStatuses.set(t.url, {});
    urlRefCommits.set(t.url, {});
  }

  // Collect all ref names across all ok servers, excluding peeled tag entries
  // (refs/tags/foo^{}) — those are dereference helpers, not real refs.
  const allRefNames = new Set<string>();
  for (const t of trackers) {
    if (t.status === "ok" && t.state.infoRefs) {
      for (const refName of Object.keys(t.state.infoRefs.refs)) {
        if (!refName.endsWith("^{}")) {
          allRefNames.add(refName);
        }
      }
    }
  }

  const crossRefDiscrepancies: RefDiscrepancy[] = [];
  const hasStateEvent =
    stateEvent !== undefined && stateEvent !== null && stateEose;

  for (const refName of allRefNames) {
    // Build a map of url → commit for this ref (only ok servers).
    // For annotated tags, prefer the peeled commit hash (refName + "^{}")
    // because the state event stores the peeled commit, not the tag object.
    const peeledRefName = refName + "^{}";
    const serverCommits: Array<{ url: string; commit: string }> = [];
    for (const t of trackers) {
      if (t.status === "ok" && t.state.infoRefs) {
        // Use the peeled commit when available (annotated tag), otherwise the
        // raw ref value (lightweight tag or branch).
        const commit =
          t.state.infoRefs.refs[peeledRefName] ??
          t.state.infoRefs.refs[refName];
        if (commit) {
          serverCommits.push({ url: t.url, commit });
        }
      }
    }

    // Determine the "expected" commit for this ref
    let expectedCommit: string | undefined;
    if (hasStateEvent && stateEvent) {
      const stateRef = stateEvent.refs.find((r) => r.name === refName);
      expectedCommit = stateRef?.commitId;
    } else if (serverCommits.length > 0) {
      // No state event — use the first server's commit as the reference
      expectedCommit = serverCommits[0].commit;
    }

    // Assign per-URL status for this ref
    let disagreeCount = 0;
    for (const { url, commit } of serverCommits) {
      const statusMap = urlRefStatuses.get(url)!;
      const commitMap = urlRefCommits.get(url)!;
      commitMap[refName] = commit;

      if (!expectedCommit) {
        // State event exists but doesn't mention this ref — can't compare
        statusMap[refName] = "connected";
      } else if (commitsMatch(commit, expectedCommit)) {
        statusMap[refName] = "match";
      } else {
        statusMap[refName] = "behind";
        disagreeCount++;
      }
    }

    // Cross-ref discrepancy: refs where servers disagree (2+ servers needed)
    if (serverCommits.length >= 2 && disagreeCount > 0) {
      crossRefDiscrepancies.push({
        refName,
        disagreeCount,
        totalServers: serverCommits.length,
        expectedCommit,
        servers: serverCommits.map(({ url, commit }) => ({
          url,
          commit,
          matches: expectedCommit ? commitsMatch(commit, expectedCommit) : true,
        })),
      });
    }
  }

  // For error/untested/permanent-failure URLs, set status based on connection
  for (const t of trackers) {
    const statusMap = urlRefStatuses.get(t.url)!;
    if (t.status === "permanent-failure" || t.status === "error") {
      // Mark all known refs as "error" for this URL
      for (const refName of allRefNames) {
        statusMap[refName] = "error";
      }
    } else if (t.status === "untested") {
      for (const refName of allRefNames) {
        statusMap[refName] = "unknown";
      }
    }
  }

  return { urlRefStatuses, urlRefCommits, crossRefDiscrepancies };
}

// ---------------------------------------------------------------------------
// GitGraspPool
// ---------------------------------------------------------------------------

export class GitGraspPool {
  // --- Internal services ---
  private cors: CorsProxyManager;
  /** The shared content-addressed object cache. Read-only access for consumers. */
  readonly cache: GitObjectCache;
  private http: GitHttpClient;
  private urlManager: UrlStateManager;
  private stateManager: StateEventManager;

  // --- Observable state ---
  private state$ = new BehaviorSubject<PoolState>(makeInitialState());

  // --- Subscriber management ---
  private subscribers = new Set<PoolSubscriber>();
  private evictTimer: ReturnType<typeof setTimeout> | null = null;
  private evictionGraceMs: number;

  // --- Fetch lifecycle ---
  private abort: AbortController | null = null;
  private fetching = false;
  private fetchedOnce = false;

  // --- State event subscription ---
  private stateEventSub: Subscription | null = null;

  // --- Winner tracking ---
  private winnerUrl: string | null = null;

  constructor(options: PoolOptions) {
    this.evictionGraceMs =
      options.evictionGracePeriodMs ?? DEFAULT_EVICTION_GRACE_MS;

    // Initialize services
    this.cors = new CorsProxyManager(
      options.corsProxyBase,
      options.knownCorsBlockedOrigins,
    );
    this.cache = new GitObjectCache(options.infoRefsTtlMs);
    this.http = new GitHttpClient(this.cache, this.cors);
    this.urlManager = new UrlStateManager(this.cors);
    this.stateManager = new StateEventManager();

    // Add initial URLs
    this.urlManager.addUrls(options.cloneUrls);

    // Subscribe to state event observable if provided
    if (options.stateEvent$) {
      this.stateEventSub = options.stateEvent$.subscribe((stateEvent) => {
        this.onStateEventChange(stateEvent);
      });
    }
  }

  // -----------------------------------------------------------------------
  // Observable state
  // -----------------------------------------------------------------------

  /** Get the current state as an RxJS observable */
  get observable(): Observable<PoolState> {
    return this.state$.asObservable();
  }

  /** Get the current state snapshot */
  getState(): PoolState {
    return this.state$.getValue();
  }

  // -----------------------------------------------------------------------
  // Subscriber management
  // -----------------------------------------------------------------------

  /**
   * Subscribe to pool state changes. Returns an unsubscribe function.
   * Triggers the initial fetch if not already started.
   */
  subscribe(cb: PoolSubscriber): () => void {
    // Cancel any pending eviction
    if (this.evictTimer !== null) {
      clearTimeout(this.evictTimer);
      this.evictTimer = null;
    }

    this.subscribers.add(cb);

    // Deliver current state immediately
    cb(this.state$.getValue());

    // Start fetching if we haven't yet
    if (!this.fetchedOnce && !this.fetching) {
      this.startFetch();
    }

    return () => {
      this.subscribers.delete(cb);
      if (this.subscribers.size === 0) {
        this.scheduleEviction();
      }
    };
  }

  private notify(): void {
    const state = this.state$.getValue();
    for (const cb of this.subscribers) {
      cb(state);
    }
  }

  private setState(updater: (prev: PoolState) => PoolState): void {
    const next = updater(this.state$.getValue());
    this.state$.next(next);
    this.notify();
  }

  // -----------------------------------------------------------------------
  // Dynamic URL management
  // -----------------------------------------------------------------------

  /**
   * Add new clone URLs to the pool. Called when new announcement events
   * arrive and the clone URL list grows.
   *
   * New URLs are immediately tested (infoRefs fetch) if the pool has
   * already completed its initial fetch. If the pool is still in its
   * initial fetch, the new URLs are included in the current race.
   */
  addUrls(urls: string[]): void {
    const newUrls = this.urlManager.addUrls(urls);
    if (newUrls.length === 0) return;

    // Update state to include new URLs
    this.setState((prev) => ({
      ...prev,
      urls: this.urlManager.toStateRecord(),
    }));

    // If we've already fetched, probe the new URLs
    if (this.fetchedOnce && !this.fetching) {
      this.probeNewUrls(newUrls);
    }
    // If currently fetching, the new URLs will be picked up by the
    // in-progress fetch since urlManager is shared
  }

  /**
   * Probe newly-added URLs by fetching their infoRefs.
   * If any new URL is faster or has data the current winner doesn't,
   * it may become the new winner.
   */
  private async probeNewUrls(urls: string[]): Promise<void> {
    const abort = new AbortController();
    const signal = abort.signal;

    for (const url of urls) {
      // Short-circuit for non-HTTP URLs
      if (isNonHttpUrl(url)) {
        const tracker = this.urlManager.get(url);
        if (tracker) {
          tracker.recordPermanentFailure(
            `URL uses a non-HTTP scheme and cannot be fetched by the browser: ${url}`,
            "not-http",
          );
        }
        this.setState((prev) => ({
          ...prev,
          urls: this.urlManager.toStateRecord(),
          health: this.computeHealth(),
        }));
        continue;
      }

      try {
        const start = Date.now();
        const info = await this.http.fetchInfoRefs(url, signal);
        const latency = Date.now() - start;

        if (signal.aborted) return;

        const tracker = this.urlManager.get(url);
        if (tracker) {
          tracker.recordInfoRefsSuccess(info, latency);
        }

        // Re-evaluate winner
        const newWinner = this.urlManager.selectBestUrl(
          this.winnerUrl ?? undefined,
        );
        if (newWinner && newWinner !== this.winnerUrl) {
          this.winnerUrl = newWinner;
        }

        this.setState((prev) => ({
          ...prev,
          urls: this.urlManager.toStateRecord(),
          winnerUrl: this.winnerUrl,
          health: this.computeHealth(),
        }));
      } catch (err) {
        if (signal.aborted) return;
        const tracker = this.urlManager.get(url);
        if (tracker) {
          const { errorClass, kind } = classifyFetchError(err);
          const msg = err instanceof Error ? err.message : String(err);
          if (errorClass === "permanent") {
            tracker.recordPermanentFailure(msg, kind);
          } else {
            tracker.recordTransientError(msg, kind);
          }
        }
        this.setState((prev) => ({
          ...prev,
          urls: this.urlManager.toStateRecord(),
          health: this.computeHealth(),
        }));
      }
    }
  }

  // -----------------------------------------------------------------------
  // Nostr state event integration
  // -----------------------------------------------------------------------

  private onStateEventChange(stateEvent: StateEventInput): void {
    const prevState = this.stateManager.currentState;
    this.stateManager.update(stateEvent);

    if (stateEvent === undefined || stateEvent === null) {
      // State cleared or still loading — recompute warning
      this.setState((prev) => ({
        ...prev,
        warning: null,
      }));
      return;
    }

    // If the state event changed and we've already fetched, check if we
    // need to re-fetch
    if (this.fetchedOnce && !this.fetching) {
      const refsChanged = !this.stateManager.refsMatchLastFetched(
        this.buildLastFetchedRefs(),
      );
      if (refsChanged) {
        // Invalidate infoRefs caches so we get fresh data
        for (const url of this.urlManager.getLiveUrls()) {
          this.cache.invalidateInfoRefs(url);
        }
        this.stateManager.scheduleBackoffFetch(() => this.startFetch());
        this.setState((prev) => ({
          ...prev,
          retryAt: this.stateManager.retryAt,
        }));
      }
    } else if (!this.fetchedOnce && !this.fetching) {
      // Haven't started yet — the next subscribe() will trigger startFetch
      // which will use the state event data
    } else if (this.fetching) {
      // Fetch in progress — if we just learned the state commit for the
      // first time, restart the fetch so the fast-path cache check runs
      if (prevState === undefined || prevState === null) {
        this.startFetch();
      }
    }
  }

  private buildLastFetchedRefs(): Record<string, string> {
    const refs: Record<string, string> = {};
    for (const tracker of this.urlManager.getAll()) {
      if (tracker.state.infoRefs) {
        for (const [refName, commitId] of Object.entries(
          tracker.state.infoRefs.refs,
        )) {
          if (!(refName in refs)) {
            refs[refName] = commitId;
          }
        }
      }
    }
    return refs;
  }

  // -----------------------------------------------------------------------
  // Fetch lifecycle
  // -----------------------------------------------------------------------

  private startFetch(): void {
    this.stateManager.cancelBackoff();
    // Clear retryAt in state since we're fetching now
    this.setState((prev) => ({ ...prev, retryAt: null }));
    this.runFetch();
  }

  private async runFetch(): Promise<void> {
    const allUrls = this.urlManager.getLiveUrls();
    if (allUrls.length === 0) {
      this.fetching = false;
      this.fetchedOnce = true;
      this.setState((prev) => ({
        ...prev,
        loading: false,
        pulling: false,
        error: "Could not reach any clone URL",
        health: "all-failed",
      }));
      return;
    }

    // Abort any previous in-flight fetch
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const signal = abort.signal;

    this.fetching = true;

    const knownState = this.stateManager.currentState;
    const knownHeadCommit =
      knownState && knownState !== null ? knownState.headCommitId : undefined;
    const stateCreatedAt =
      knownState && knownState !== null ? knownState.createdAt : undefined;

    // -------------------------------------------------------------------
    // Fast-path: stale-while-revalidate from cache
    // -------------------------------------------------------------------
    let hasCachedData = false;

    if (knownHeadCommit) {
      // Check if any cached infoRefs shows git is ahead
      let cachedGitAheadCommit: string | null = null;
      let cachedGitAheadUrl: string | null = null;

      for (const url of allUrls) {
        const cachedInfo =
          this.cache.peekInfoRefs(url) ?? (await this.cache.getInfoRefs(url));
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
          cachedGitAheadCommit = headCommit;
          cachedGitAheadUrl = url;
          break;
        }
      }

      if (
        cachedGitAheadCommit &&
        cachedGitAheadUrl &&
        stateCreatedAt !== undefined
      ) {
        // Git is ahead — check if we have the commit cached too
        const gitCommit =
          this.cache.peekCommit(cachedGitAheadCommit) ??
          (await this.cache.getCommit(cachedGitAheadCommit));
        if (signal.aborted) {
          this.fetching = false;
          return;
        }
        if (gitCommit) {
          const gitCommitterDate =
            gitCommit.committer?.timestamp ?? gitCommit.author.timestamp;
          this.setState((prev) => ({
            ...prev,
            loading: false,
            pulling: false,
            latestCommit: gitCommit,
            readmeContent:
              this.cache.getText(cachedGitAheadCommit!, "README.md") ?? null,
            readmeFilename:
              this.cache.getText(cachedGitAheadCommit!, "README.md") !==
              undefined
                ? "README.md"
                : null,
            warning: {
              kind: "state-behind-git",
              stateCommitId: knownHeadCommit,
              gitCommitId: gitCommit.hash,
              gitServerUrl: cachedGitAheadUrl!,
              stateCreatedAt,
              gitCommitterDate,
            },
          }));
          hasCachedData = true;
        }
      } else if (!cachedGitAheadCommit) {
        // No git-ahead situation — try to show the state commit from cache
        const cachedCommit =
          this.cache.peekCommit(knownHeadCommit) ??
          (await this.cache.getCommit(knownHeadCommit));
        if (signal.aborted) {
          this.fetching = false;
          return;
        }
        if (cachedCommit) {
          const cachedText = this.cache.getText(knownHeadCommit, "README.md");
          this.setState((prev) => ({
            ...prev,
            loading: true,
            pulling: true,
            latestCommit: cachedCommit,
            readmeContent: cachedText ?? prev.readmeContent,
            readmeFilename: cachedText ? "README.md" : prev.readmeFilename,
            warning: null,
          }));
          hasCachedData = true;
        }
      }
    }

    if (!hasCachedData) {
      this.setState((prev) => ({
        ...prev,
        loading: true,
        pulling: false,
        error: null,
        latestCommit: null,
        readmeContent: null,
        readmeFilename: null,
        defaultBranch: null,
        warning: null,
      }));
    }

    if (signal.aborted) {
      this.fetching = false;
      return;
    }

    // -------------------------------------------------------------------
    // Phase 1 shortcut: if we know the state HEAD, start fetching it now
    // -------------------------------------------------------------------
    let stateCommitFetched = false;
    let stateCommitFetchPending = !!knownHeadCommit;

    if (knownHeadCommit) {
      this.fetchStateCommit(knownHeadCommit, allUrls, signal).then(
        (result) => {
          if (signal.aborted) return;
          stateCommitFetchPending = false;
          if (result) {
            stateCommitFetched = true;
            this.maybeUpdateDisplay(
              result.commit,
              result.readmeContent,
              result.readmeFilename,
              true,
              knownHeadCommit,
              stateCreatedAt,
              signal,
            );
          }
        },
        () => {
          stateCommitFetchPending = false;
        },
      );
    }

    // -------------------------------------------------------------------
    // Phase 2: race infoRefs across all URLs
    // -------------------------------------------------------------------
    let infoRefsSettled = 0;
    const totalUrls = allUrls.length;
    let anyGitHeadDiffersFromState = false;
    let bestGitResult: { commit: Commit; url: string } | null = null;
    let defaultBranch: string | null = null;

    const infoRefsPromises = allUrls.map(async (url) => {
      const tracker = this.urlManager.getOrCreate(url);

      // Short-circuit immediately for non-HTTP URLs (SSH, git://, etc.)
      // — the browser cannot fetch these at all.
      if (isNonHttpUrl(url)) {
        tracker.recordPermanentFailure(
          `URL uses a non-HTTP scheme and cannot be fetched by the browser: ${url}`,
          "not-http",
        );
        this.setState((prev) => ({
          ...prev,
          urls: this.urlManager.toStateRecord(),
        }));
        return;
      }

      try {
        const start = Date.now();
        const info = await this.http.fetchInfoRefs(url, signal);
        const latency = Date.now() - start;

        if (signal.aborted) return;

        tracker.recordInfoRefsSuccess(info, latency);

        const headRef = info.symrefs["HEAD"];
        const headCommit = headRef
          ? info.refs[headRef]
          : Object.values(info.refs)[0];

        // Extract default branch
        if (headRef?.startsWith("refs/heads/") && !defaultBranch) {
          defaultBranch = headRef.replace("refs/heads/", "");
          this.setState((prev) => ({ ...prev, defaultBranch }));
        }

        // Update state with this URL's result
        this.setState((prev) => ({
          ...prev,
          urls: this.urlManager.toStateRecord(),
        }));

        if (!headCommit) return;

        const matchesStateCommit =
          knownHeadCommit &&
          (headCommit.startsWith(knownHeadCommit) ||
            knownHeadCommit.startsWith(headCommit));

        if (!matchesStateCommit) {
          anyGitHeadDiffersFromState = true;
          // Fetch this commit to compare with state
          const result = await this.http.fetchCommit(
            url,
            headCommit,
            info.capabilities.includes("filter"),
            signal,
          );
          if (signal.aborted || !result) return;

          const committerDate =
            result.commit.committer?.timestamp ??
            result.commit.author.timestamp;
          if (
            !bestGitResult ||
            committerDate >
              (bestGitResult.commit.committer?.timestamp ??
                bestGitResult.commit.author.timestamp)
          ) {
            bestGitResult = { commit: result.commit, url };
          }

          this.maybeUpdateDisplay(
            result.commit,
            result.readmeContent,
            result.readmeFilename,
            false,
            knownHeadCommit,
            stateCreatedAt,
            signal,
          );
        } else if (!knownHeadCommit) {
          // No state event — fetch the git server's HEAD
          const result = await this.http.fetchCommit(
            url,
            headCommit,
            info.capabilities.includes("filter"),
            signal,
          );
          if (signal.aborted || !result) return;
          this.maybeUpdateDisplay(
            result.commit,
            result.readmeContent,
            result.readmeFilename,
            false,
            knownHeadCommit,
            stateCreatedAt,
            signal,
          );
        }
      } catch (err) {
        if (signal.aborted) return;
        const { errorClass, kind } = classifyFetchError(err);
        const msg = err instanceof Error ? err.message : String(err);
        if (errorClass === "permanent") {
          tracker.recordPermanentFailure(msg, kind);
        } else {
          tracker.recordTransientError(msg, kind);
        }
        this.setState((prev) => ({
          ...prev,
          urls: this.urlManager.toStateRecord(),
        }));
      } finally {
        if (!signal.aborted) {
          infoRefsSettled++;
          if (infoRefsSettled === totalUrls) {
            this.onAllInfoRefsSettled(
              signal,
              knownHeadCommit,
              stateCreatedAt,
              stateCommitFetched,
              stateCommitFetchPending,
              anyGitHeadDiffersFromState,
              bestGitResult,
            );
          }
        }
      }
    });

    // Don't await — the promises settle independently and update state
    // as they go. The pool is ready to serve cached data immediately.
    void Promise.allSettled(infoRefsPromises);
  }

  /**
   * Fetch the state commit from any URL that's likely to have it.
   */
  private async fetchStateCommit(
    commitHash: string,
    urls: string[],
    signal: AbortSignal,
  ): Promise<{
    commit: Commit;
    readmeContent: string | null;
    readmeFilename: string | null;
  } | null> {
    // Filter to URLs whose cached infoRefs match the state commit
    const likelyUrls = urls.filter((url) => {
      const cached = this.cache.peekInfoRefs(url);
      if (!cached) return true;
      const headRef = cached.symrefs["HEAD"];
      const headCommit = headRef
        ? cached.refs[headRef]
        : Object.values(cached.refs)[0];
      if (!headCommit) return true;
      return (
        headCommit.startsWith(commitHash) || commitHash.startsWith(headCommit)
      );
    });

    if (likelyUrls.length === 0) return null;

    try {
      return await Promise.any(
        likelyUrls.map(async (url) => {
          const result = await this.http.fetchCommit(
            url,
            commitHash,
            true,
            signal,
          );
          if (!result) throw new Error("not found");
          return result;
        }),
      );
    } catch {
      return null;
    }
  }

  /**
   * Update the displayed commit if the new result is newer.
   */
  private maybeUpdateDisplay(
    commit: Commit,
    readmeContent: string | null,
    readmeFilename: string | null,
    isStateCommit: boolean,
    knownHeadCommit: string | undefined,
    stateCreatedAt: number | undefined,
    signal: AbortSignal,
  ): void {
    if (signal.aborted) return;

    const committerDate =
      commit.committer?.timestamp ?? commit.author.timestamp;
    const current = this.state$.getValue();

    const currentCommitterDate = current.latestCommit
      ? (current.latestCommit.committer?.timestamp ??
        current.latestCommit.author.timestamp)
      : 0;

    if (!current.latestCommit || committerDate > currentCommitterDate) {
      this.setState((prev) => ({
        ...prev,
        loading: false,
        pulling: false,
        latestCommit: commit,
        readmeContent: readmeContent ?? prev.readmeContent,
        readmeFilename: readmeFilename ?? prev.readmeFilename,
      }));
    }
  }

  /**
   * Called when all infoRefs fetches have settled.
   */
  private onAllInfoRefsSettled(
    signal: AbortSignal,
    knownHeadCommit: string | undefined,
    stateCreatedAt: number | undefined,
    stateCommitFetched: boolean,
    stateCommitFetchPending: boolean,
    anyGitHeadDiffersFromState: boolean,
    bestGitResult: { commit: Commit; url: string } | null,
  ): void {
    if (signal.aborted) return;

    // Select winner
    this.winnerUrl = this.urlManager.selectBestUrl(this.winnerUrl ?? undefined);

    const current = this.state$.getValue();

    // Compute warning
    let warning: PoolWarning | null = null;

    if (
      knownHeadCommit &&
      !stateCommitFetched &&
      anyGitHeadDiffersFromState &&
      !stateCommitFetchPending
    ) {
      warning = {
        kind: "state-commit-unavailable",
        stateCommitId: knownHeadCommit,
      };
    } else if (
      knownHeadCommit &&
      stateCreatedAt !== undefined &&
      bestGitResult &&
      anyGitHeadDiffersFromState
    ) {
      const displayHash = current.latestCommit?.hash;
      if (
        displayHash &&
        !displayHash.startsWith(knownHeadCommit) &&
        !knownHeadCommit.startsWith(displayHash)
      ) {
        const gitCommitterDate =
          bestGitResult.commit.committer?.timestamp ??
          bestGitResult.commit.author.timestamp;
        warning = {
          kind: "state-behind-git",
          stateCommitId: knownHeadCommit,
          gitCommitId: bestGitResult.commit.hash,
          gitServerUrl: bestGitResult.url,
          stateCreatedAt,
          gitCommitterDate,
        };
      }
    }

    this.fetching = false;
    this.fetchedOnce = true;

    const hasResult = current.latestCommit !== null;
    const stateEventForRefs = this.stateManager.currentState;
    const stateEose = stateEventForRefs !== undefined;

    // Compute per-URL ref statuses and cross-ref discrepancies
    const { urlRefStatuses, urlRefCommits, crossRefDiscrepancies } =
      computeRefStatuses(
        this.urlManager.getAll(),
        stateEventForRefs,
        stateEose,
      );

    // Push computed ref statuses into each tracker
    for (const tracker of this.urlManager.getAll()) {
      const refStatus = urlRefStatuses.get(tracker.url) ?? {};
      const refCommits = urlRefCommits.get(tracker.url) ?? {};
      tracker.updateRefStatus(refStatus, refCommits);
    }

    this.setState((prev) => ({
      ...prev,
      loading: false,
      pulling: false,
      error: hasResult ? null : "Could not reach any clone URL",
      health: this.computeHealth(),
      winnerUrl: this.winnerUrl,
      warning,
      lastCheckedAt: hasResult
        ? Math.floor(Date.now() / 1000)
        : prev.lastCheckedAt,
      urls: this.urlManager.toStateRecord(),
      crossRefDiscrepancies,
      retryAt: this.stateManager.retryAt,
    }));

    // Handle backoff for state event mismatch
    if (hasResult) {
      const lastFetchedRefs = this.buildLastFetchedRefs();
      const stateEvent = this.stateManager.currentState;
      if (
        stateEvent &&
        stateEvent !== null &&
        !this.stateManager.refsMatchLastFetched(lastFetchedRefs)
      ) {
        // Check if git is ahead (server has different commit than state)
        const gitIsAhead = this.urlManager.getAll().some((t) => {
          if (t.status !== "ok" || !t.state.infoRefs) return false;
          const headRef = t.state.infoRefs.symrefs["HEAD"];
          const headCommit = headRef
            ? t.state.infoRefs.refs[headRef]
            : Object.values(t.state.infoRefs.refs)[0];
          if (!headCommit) return false;
          return (
            !headCommit.startsWith(stateEvent.headCommitId) &&
            !stateEvent.headCommitId.startsWith(headCommit)
          );
        });

        if (!gitIsAhead) {
          // State is ahead of git — servers haven't caught up yet, retry
          this.stateManager.scheduleBackoffFetch(() => this.startFetch());
          // Update retryAt in state now that it's been set
          this.setState((prev) => ({
            ...prev,
            retryAt: this.stateManager.retryAt,
          }));
        } else {
          // Git is ahead — reset backoff
          this.stateManager.resetBackoff();
        }
      } else {
        this.stateManager.resetBackoff();
      }
    } else {
      // All failed — retry if there are retryable URLs
      const hasRetryable = this.urlManager.getLiveUrls().length > 0;
      if (hasRetryable && this.stateManager.currentState) {
        this.stateManager.scheduleBackoffFetch(() => this.startFetch());
      }
    }
  }

  private computeHealth(): PoolHealth {
    const all = this.urlManager.getAll();
    if (all.length === 0) return "idle";

    const ok = all.filter((t) => t.status === "ok").length;
    const failed = all.filter((t) => t.status === "permanent-failure").length;
    const untested = all.filter((t) => t.status === "untested").length;

    if (ok === 0 && failed === all.length) return "all-failed";
    if (untested === all.length) return "connecting";
    if (ok > 0 && failed === 0) return "ok";
    if (ok > 0) return "degraded";
    return "connecting";
  }

  // -----------------------------------------------------------------------
  // Public API — git operations
  // -----------------------------------------------------------------------

  /**
   * Get the directory tree at a commit hash.
   * Routes through the winning URL with fallback.
   *
   * @param fallbackUrls - Extra URLs to try after the pool's own URLs if the
   *   data is not found. These are not tracked by the pool and are only used
   *   for this single operation (e.g. PR author's fork clone URLs).
   */
  async getTree(
    commitHash: string,
    nestLimit: number,
    signal: AbortSignal,
    fallbackUrls?: string[],
  ): Promise<Tree | null> {
    // Check cache first (synchronous peek)
    const cached = this.cache.peekTree(commitHash, nestLimit);
    if (cached) return cached;

    // Try async cache (IDB)
    const idbCached = await this.cache.getTree(commitHash, nestLimit);
    if (idbCached) return idbCached;

    // Fetch from git server
    return this.withFallback(
      signal,
      async (url) => {
        const start = Date.now();
        const result = await this.http.fetchTree(
          url,
          commitHash,
          nestLimit,
          signal,
        );
        if (result) {
          const tracker = this.urlManager.get(url);
          tracker?.recordOperationSuccess(Date.now() - start);
        }
        return result;
      },
      fallbackUrls,
    );
  }

  /**
   * Get a blob by its object hash.
   *
   * @param fallbackUrls - Extra URLs to try after the pool's own URLs if the
   *   data is not found. Not tracked by the pool.
   */
  async getBlob(
    blobHash: string,
    signal: AbortSignal,
    fallbackUrls?: string[],
  ): Promise<Uint8Array | null> {
    const cached = this.cache.peekBlob(blobHash);
    if (cached) return cached;

    const idbCached = await this.cache.getBlob(blobHash);
    if (idbCached) return idbCached;

    return this.withFallback(
      signal,
      async (url) => {
        const start = Date.now();
        const result = await this.http.fetchBlob(url, blobHash, signal);
        if (result) {
          const tracker = this.urlManager.get(url);
          tracker?.recordOperationSuccess(Date.now() - start);
        }
        return result;
      },
      fallbackUrls,
    );
  }

  /**
   * Get an object by path within a commit.
   *
   * @param fallbackUrls - Extra URLs to try after the pool's own URLs if the
   *   data is not found. Not tracked by the pool.
   */
  async getObjectByPath(
    commitHash: string,
    path: string,
    signal: AbortSignal,
    fallbackUrls?: string[],
  ): Promise<{ hash: string; isDir: boolean; data: Uint8Array | null } | null> {
    return this.withFallback(
      signal,
      async (url) => {
        const start = Date.now();
        const result = await this.http.fetchObjectByPath(
          url,
          commitHash,
          path,
          signal,
        );
        if (result) {
          const tracker = this.urlManager.get(url);
          tracker?.recordOperationSuccess(Date.now() - start);
          return {
            hash: result.entry.hash,
            isDir: result.entry.isDir,
            data: result.data,
          };
        }
        return null;
      },
      fallbackUrls,
    );
  }

  /**
   * Get commit history for a commit hash.
   *
   * @param fallbackUrls - Extra URLs to try after the pool's own URLs if the
   *   data is not found. Not tracked by the pool.
   */
  async getCommitHistory(
    commitHash: string,
    maxCommits: number,
    signal: AbortSignal,
    fallbackUrls?: string[],
  ): Promise<Commit[] | null> {
    const cached = this.cache.peekCommitHistory(commitHash, maxCommits);
    if (cached) return cached;

    const idbCached = await this.cache.getCommitHistory(commitHash, maxCommits);
    if (idbCached) return idbCached;

    return this.withFallback(
      signal,
      async (url) => {
        const start = Date.now();
        const result = await this.http.fetchCommitHistory(
          url,
          commitHash,
          maxCommits,
          signal,
        );
        if (result) {
          const tracker = this.urlManager.get(url);
          tracker?.recordOperationSuccess(Date.now() - start);
        }
        return result;
      },
      fallbackUrls,
    );
  }

  /**
   * Get a single commit by hash.
   *
   * @param fallbackUrls - Extra URLs to try after the pool's own URLs if the
   *   data is not found. Not tracked by the pool.
   */
  async getSingleCommit(
    commitHash: string,
    signal: AbortSignal,
    fallbackUrls?: string[],
  ): Promise<Commit | null> {
    const cached = this.cache.peekCommit(commitHash);
    if (cached) return cached;

    const idbCached = await this.cache.getCommit(commitHash);
    if (idbCached) return idbCached;

    return this.withFallback(
      signal,
      async (url) => {
        const start = Date.now();
        const result = await this.http.fetchSingleCommit(
          url,
          commitHash,
          signal,
        );
        if (result) {
          const tracker = this.urlManager.get(url);
          tracker?.recordOperationSuccess(Date.now() - start);
        }
        return result;
      },
      fallbackUrls,
    );
  }

  /**
   * Find the merge base between a PR tip commit and the default branch.
   *
   * Strategy:
   *   1. Fetch the default branch's commit history (up to `maxDepth` commits)
   *      and build a Set of those hashes.
   *   2. Walk the PR tip's commit chain (up to `maxDepth` commits), checking
   *      each commit against the Set.
   *   3. The first PR-chain commit found in the default branch history is the
   *      merge base.
   *
   * Fallback (author heuristic):
   *   If no commit from the PR chain appears in the default branch history
   *   (e.g. the branch diverged further back than `maxDepth`), we fall back
   *   to scanning the PR commit chain for the first commit whose author email
   *   differs from the PR tip's author email. This catches the common case
   *   where all PR commits share the same author but the base commit was
   *   authored by someone else (e.g. a maintainer's merge commit).
   *
   * Returns the merge-base commit hash, or null if it cannot be determined.
   *
   * @param prTipCommitId   - The tip commit of the PR branch.
   * @param fallbackUrls    - Extra clone URLs to try (e.g. PR author's fork).
   * @param maxDepth        - How many commits to walk in each chain (default 200).
   */
  async findMergeBase(
    prTipCommitId: string,
    signal: AbortSignal,
    fallbackUrls?: string[],
    maxDepth = 200,
  ): Promise<string | null> {
    // Resolve the default branch commit from infoRefs.
    const info = this.getInfoRefs();
    if (!info) return null;

    const headRef = info.symrefs["HEAD"];
    const defaultBranchCommit = headRef
      ? info.refs[headRef]
      : Object.values(info.refs)[0];
    if (!defaultBranchCommit) return null;

    // If the PR tip IS the default branch head, there are no PR-specific commits.
    if (defaultBranchCommit === prTipCommitId) return null;

    // Fetch both commit chains in parallel.
    const [prChain, defaultChain] = await Promise.all([
      this.getCommitHistory(prTipCommitId, maxDepth, signal, fallbackUrls),
      this.getCommitHistory(defaultBranchCommit, maxDepth, signal),
    ]);

    if (signal.aborted) return null;

    if (!prChain || prChain.length === 0) return null;

    if (defaultChain && defaultChain.length > 0) {
      // Build a set of hashes from the default branch chain.
      const defaultSet = new Set(defaultChain.map((c) => c.hash));

      // Walk the PR chain from tip to root, return the first commit that
      // appears in the default branch history.
      for (const commit of prChain) {
        if (defaultSet.has(commit.hash)) {
          return commit.hash;
        }
      }
    }

    // Author heuristic fallback: find the first commit in the PR chain whose
    // author email differs from the PR tip's author email. This handles the
    // common case where the PR author's commits are at the top of the chain
    // and the base commit was authored by someone else.
    const prTipAuthorEmail = prChain[0]?.author.email;
    if (prTipAuthorEmail) {
      for (let i = 1; i < prChain.length; i++) {
        if (prChain[i].author.email !== prTipAuthorEmail) {
          // The previous commit (i-1) is the last PR-authored commit;
          // this commit (i) is the first base commit.
          return prChain[i].hash;
        }
      }
    }

    return null;
  }

  /**
   * Fetch the data needed to compute a diff between two commits.
   *
   * Returns both commits and both complete recursive directory trees
   * (metadata only — no file content). The trees are fetched with
   * blob:none so only tree objects (~30 bytes per directory entry) are
   * transferred, not file content.
   *
   * Each fetchFullTree call returns both the commit and the tree from the
   * same packfile response, so no separate getSingleCommit requests are made.
   * Two fetches instead of four in the common (uncached) case.
   *
   * All fetches run in parallel and are individually cached.
   * Repeat calls for the same pair are instant.
   *
   * The caller is responsible for:
   *   1. Walking tipTree and baseTree to find added/deleted/modified paths
   *   2. Fetching changed file content via pool.getBlob()
   *   3. Generating unified diff output from the blob pairs
   *
   * @param fallbackUrls - Extra URLs to try after the pool's own URLs if the
   *   data is not found. Not tracked by the pool.
   */
  async getCommitRange(
    tipCommitId: string,
    baseCommitId: string,
    signal: AbortSignal,
    fallbackUrls?: string[],
  ): Promise<CommitRangeData | null> {
    const [tipResult, baseResult] = await Promise.all([
      this.withFallback(
        signal,
        async (url) => {
          const start = Date.now();
          const result = await this.http.fetchFullTree(
            url,
            tipCommitId,
            signal,
          );
          if (result) {
            const tracker = this.urlManager.get(url);
            tracker?.recordOperationSuccess(Date.now() - start);
          }
          return result;
        },
        fallbackUrls,
      ),
      this.withFallback(
        signal,
        async (url) => {
          const start = Date.now();
          const result = await this.http.fetchFullTree(
            url,
            baseCommitId,
            signal,
          );
          if (result) {
            const tracker = this.urlManager.get(url);
            tracker?.recordOperationSuccess(Date.now() - start);
          }
          return result;
        },
        fallbackUrls,
      ),
    ]);

    if (!tipResult || !baseResult) return null;

    return {
      tipCommit: tipResult.commit,
      baseCommit: baseResult.commit,
      tipTree: tipResult.tree,
      baseTree: baseResult.tree,
    };
  }

  /**
   * Get infoRefs for a specific URL (or the winner).
   * Primarily for UI components that need ref data.
   */
  getInfoRefs(url?: string): InfoRefsUploadPackResponse | null {
    const targetUrl = url ?? this.winnerUrl;
    if (!targetUrl) return null;
    const tracker = this.urlManager.get(targetUrl);
    return tracker?.state.infoRefs ?? null;
  }

  /**
   * Returns true if the given URL is currently being routed through the
   * CORS proxy. Useful for UI components that display proxy status.
   */
  urlUsesProxy(url: string): boolean {
    return this.cors.urlUsesProxy(url);
  }

  // -----------------------------------------------------------------------
  // Fallback execution
  // -----------------------------------------------------------------------

  /**
   * Execute an operation with the winning URL, falling back to other live
   * URLs on failure.
   *
   * @param fallbackUrls - Extra URLs to try after the pool's own ordered URLs
   *   if the operation returns null or throws. These URLs are not tracked by
   *   the pool — they are only used for this single operation invocation.
   *   Intended for PR/PR-Update clone URLs that may host commits not yet
   *   mirrored to the repo's main git servers.
   */
  private async withFallback<T>(
    signal: AbortSignal,
    operation: (url: string) => Promise<T | null>,
    fallbackUrls?: string[],
  ): Promise<T | null> {
    // Build ordered URL list: winner first, then other ok URLs by latency,
    // then any extra fallback URLs that aren't already in the pool.
    const poolUrls = this.getOrderedUrls();
    const poolUrlSet = new Set(poolUrls);
    const extraUrls = fallbackUrls
      ? fallbackUrls.filter((u) => !poolUrlSet.has(u) && !isNonHttpUrl(u))
      : [];
    const urls = [...poolUrls, ...extraUrls];

    if (urls.length === 0) return null;

    for (const url of urls) {
      if (signal.aborted) return null;
      try {
        const result = await operation(url);
        if (result !== null) {
          // If this is a pool-tracked URL that isn't the current winner,
          // consider promoting it.
          if (url !== this.winnerUrl && poolUrlSet.has(url)) {
            const newWinner = this.urlManager.selectBestUrl(
              this.winnerUrl ?? undefined,
            );
            if (newWinner !== this.winnerUrl) {
              this.winnerUrl = newWinner;
              this.setState((prev) => ({
                ...prev,
                winnerUrl: this.winnerUrl,
              }));
            }
          }
          return result;
        }
      } catch (err) {
        if (signal.aborted) return null;
        // Only record failures for pool-tracked URLs — extra fallback URLs
        // are ephemeral and should not affect pool health state.
        if (poolUrlSet.has(url)) {
          const tracker = this.urlManager.get(url);
          if (tracker) {
            const { errorClass, kind } = classifyFetchError(err);
            const msg = err instanceof Error ? err.message : String(err);
            if (errorClass === "permanent") {
              tracker.recordPermanentFailure(msg, kind);
            } else {
              tracker.recordTransientError(msg, kind);
            }
          }
        }
        // Continue to next URL
      }
    }

    return null;
  }

  /**
   * Get URLs in priority order: winner first, then other ok URLs sorted
   * by latency, then untested URLs.
   */
  private getOrderedUrls(): string[] {
    const all = this.urlManager.getAll();
    const result: string[] = [];

    // Winner first
    if (this.winnerUrl) {
      const winner = this.urlManager.get(this.winnerUrl);
      if (winner && winner.isUsable) {
        result.push(this.winnerUrl);
      }
    }

    // Other ok URLs sorted by latency
    const okUrls = all
      .filter((t) => t.status === "ok" && t.url !== this.winnerUrl)
      .sort((a, b) => a.avgLatency - b.avgLatency);
    for (const t of okUrls) {
      result.push(t.url);
    }

    // Untested URLs
    const untested = all.filter(
      (t) => t.status === "untested" && t.url !== this.winnerUrl,
    );
    for (const t of untested) {
      result.push(t.url);
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Eviction / disposal
  // -----------------------------------------------------------------------

  private scheduleEviction(): void {
    this.evictTimer = setTimeout(() => {
      if (this.subscribers.size === 0) {
        this.dispose();
      }
    }, this.evictionGraceMs);
  }

  /**
   * Dispose the pool, cleaning up all resources.
   * Called automatically after the eviction grace period, or manually.
   */
  dispose(): void {
    this.abort?.abort();
    this.stateManager.cancelBackoff();
    this.stateEventSub?.unsubscribe();
    this.stateEventSub = null;
    if (this.evictTimer !== null) {
      clearTimeout(this.evictTimer);
      this.evictTimer = null;
    }
    this.subscribers.clear();
    this.state$.complete();
  }

  /** Whether this pool has been disposed */
  get isDisposed(): boolean {
    return this.state$.closed;
  }
}
