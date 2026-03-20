/**
 * git-grasp-pool — per-URL state machine and latency tracking
 *
 * Manages the lifecycle state of each clone URL:
 *   untested → ok | error | permanent-failure
 *   ok → error | permanent-failure  (if a subsequent request fails)
 *   error → ok | permanent-failure  (if a retry succeeds or fails permanently)
 *   permanent-failure → (terminal, never retried)
 *
 * Also tracks rolling latency for winner re-evaluation.
 */

import type {
  UrlState,
  UrlConnectionStatus,
  UrlRefStatus,
  UrlErrorKind,
  InfoRefsUploadPackResponse,
} from "./types";
import type { CorsProxyManager } from "./cors-proxy";

/** Number of latency samples to keep for rolling average */
const LATENCY_WINDOW = 5;

/**
 * Tracks the state of a single clone URL within the pool.
 */
export class UrlTracker {
  private _state: UrlState;
  private latencySamples: number[] = [];
  private cors: CorsProxyManager;

  constructor(url: string, cors: CorsProxyManager) {
    this.cors = cors;
    this._state = {
      url,
      originalUrl: url,
      effectiveUrl: cors.resolveUrl(url),
      status: "untested",
      usesProxy: cors.urlUsesProxy(url),
      infoRefs: null,
      headCommit: null,
      headRef: null,
      supportsFilter: false,
      capabilities: [],
      latencyMs: null,
      lastError: null,
      lastErrorKind: null,
      lastSuccessAt: null,
      refStatus: {},
      refCommits: {},
    };
  }

  /** Current snapshot of this URL's state */
  get state(): UrlState {
    return this._state;
  }

  get url(): string {
    return this._state.url;
  }

  get status(): UrlConnectionStatus {
    return this._state.status;
  }

  get effectiveUrl(): string {
    return this._state.effectiveUrl;
  }

  get isLive(): boolean {
    return (
      this._state.status !== "permanent-failure" &&
      this._state.status !== "error"
    );
  }

  get isUsable(): boolean {
    return this._state.status !== "permanent-failure";
  }

  /** Average latency in ms, or Infinity if no samples */
  get avgLatency(): number {
    if (this.latencySamples.length === 0) return Infinity;
    const sum = this.latencySamples.reduce((a, b) => a + b, 0);
    return sum / this.latencySamples.length;
  }

  /**
   * Record a successful infoRefs fetch.
   */
  recordInfoRefsSuccess(
    info: InfoRefsUploadPackResponse,
    latencyMs: number,
  ): void {
    const headRef = info.symrefs["HEAD"];
    const headCommit = headRef
      ? info.refs[headRef]
      : (Object.values(info.refs)[0] ?? null);

    this.recordLatency(latencyMs);

    // Update effective URL in case CORS proxy status changed during the fetch
    this._state = {
      ...this._state,
      status: "ok",
      effectiveUrl: this.cors.resolveUrl(this._state.url),
      usesProxy: this.cors.urlUsesProxy(this._state.url),
      infoRefs: info,
      headCommit: headCommit ?? null,
      headRef: headRef ?? null,
      supportsFilter: info.capabilities.includes("filter"),
      capabilities: info.capabilities,
      latencyMs: this.avgLatency === Infinity ? null : this.avgLatency,
      lastError: null,
      lastErrorKind: null,
      lastSuccessAt: Date.now(),
    };
  }

  /**
   * Record a successful git operation (tree, blob, commit fetch).
   * Updates latency but doesn't change infoRefs data.
   */
  recordOperationSuccess(latencyMs: number): void {
    this.recordLatency(latencyMs);
    this._state = {
      ...this._state,
      status: "ok",
      latencyMs: this.avgLatency === Infinity ? null : this.avgLatency,
      lastError: null,
      lastErrorKind: null,
      lastSuccessAt: Date.now(),
    };
  }

  /**
   * Record a transient error (server 5xx, timeout, etc.).
   * The URL can still be retried.
   */
  recordTransientError(error: string, kind: UrlErrorKind = "transient"): void {
    this._state = {
      ...this._state,
      status: "error",
      lastError: error,
      lastErrorKind: kind,
    };
  }

  /**
   * Record a permanent failure (404, network unreachable, etc.).
   * The URL will never be retried.
   */
  recordPermanentFailure(error: string, kind: UrlErrorKind = "network"): void {
    this._state = {
      ...this._state,
      status: "permanent-failure",
      lastError: error,
      lastErrorKind: kind,
    };
  }

  /**
   * Update the per-ref sync status computed by the pool.
   * Called after all infoRefs have settled and the pool has compared
   * each server's refs against the state event (or majority).
   */
  updateRefStatus(
    refStatus: Record<string, UrlRefStatus>,
    refCommits: Record<string, string>,
  ): void {
    this._state = {
      ...this._state,
      refStatus,
      refCommits,
    };
  }

  private recordLatency(ms: number): void {
    this.latencySamples.push(ms);
    if (this.latencySamples.length > LATENCY_WINDOW) {
      this.latencySamples.shift();
    }
  }
}

// ---------------------------------------------------------------------------
// URL set manager
// ---------------------------------------------------------------------------

/**
 * Manages the set of UrlTrackers for a pool. Handles adding new URLs
 * dynamically (as new announcement events arrive).
 */
export class UrlStateManager {
  private trackers = new Map<string, UrlTracker>();
  private cors: CorsProxyManager;

  constructor(cors: CorsProxyManager) {
    this.cors = cors;
  }

  /** Get all trackers */
  getAll(): UrlTracker[] {
    return Array.from(this.trackers.values());
  }

  /** Get a specific tracker by URL */
  get(url: string): UrlTracker | undefined {
    return this.trackers.get(url);
  }

  /** Get or create a tracker for a URL */
  getOrCreate(url: string): UrlTracker {
    let tracker = this.trackers.get(url);
    if (!tracker) {
      tracker = new UrlTracker(url, this.cors);
      this.trackers.set(url, tracker);
    }
    return tracker;
  }

  /**
   * Add new URLs that weren't previously tracked.
   * Returns the list of newly-added URLs (not previously known).
   */
  addUrls(urls: string[]): string[] {
    const newUrls: string[] = [];
    for (const url of urls) {
      if (!this.trackers.has(url)) {
        this.trackers.set(url, new UrlTracker(url, this.cors));
        newUrls.push(url);
      }
    }
    return newUrls;
  }

  /** Get all URLs that haven't permanently failed */
  getLiveUrls(): string[] {
    return this.getAll()
      .filter((t) => t.isUsable)
      .map((t) => t.url);
  }

  /** Get all URLs with status "ok" */
  getOkUrls(): string[] {
    return this.getAll()
      .filter((t) => t.status === "ok")
      .map((t) => t.url);
  }

  /** Get all URLs that are untested */
  getUntestedUrls(): string[] {
    return this.getAll()
      .filter((t) => t.status === "untested")
      .map((t) => t.url);
  }

  /** Build the urls record for PoolState */
  toStateRecord(): Record<string, UrlState> {
    const record: Record<string, UrlState> = {};
    for (const [url, tracker] of this.trackers) {
      record[url] = tracker.state;
    }
    return record;
  }

  /**
   * Select the best URL based on status and latency.
   * Prefers "ok" URLs with the lowest average latency.
   * Falls back to "untested" URLs, then "error" URLs.
   */
  selectBestUrl(currentWinner?: string): string | null {
    const all = this.getAll();
    if (all.length === 0) return null;

    // If current winner is still ok, check if another URL is significantly faster
    if (currentWinner) {
      const winner = this.trackers.get(currentWinner);
      if (winner && winner.status === "ok") {
        // Simple latency-based re-evaluation: switch if another ok URL
        // has less than half the latency of the current winner
        const okTrackers = all.filter(
          (t) => t.status === "ok" && t.url !== currentWinner,
        );
        const betterUrl = okTrackers.find(
          (t) => t.avgLatency < winner.avgLatency * 0.5,
        );
        if (betterUrl) return betterUrl.url;
        return currentWinner;
      }
    }

    // Pick the best available URL
    const ok = all
      .filter((t) => t.status === "ok")
      .sort((a, b) => a.avgLatency - b.avgLatency);
    if (ok.length > 0) return ok[0].url;

    const untested = all.filter((t) => t.status === "untested");
    if (untested.length > 0) return untested[0].url;

    const errored = all.filter((t) => t.status === "error");
    if (errored.length > 0) return errored[0].url;

    return null;
  }
}
