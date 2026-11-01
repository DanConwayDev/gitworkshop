/**
 * git-grasp-pool — Nostr state event integration
 *
 * Manages the relationship between the Nostr state event (kind:30618) and
 * what the git servers actually report. Handles:
 *
 * - Tracking the current state event
 * - Detecting when refs have changed (triggering re-fetch)
 * - Exponential backoff for re-fetching when state is ahead of git servers
 * - Recency guard (only backoff-poll for recently-published state events)
 */

import type { StateEventInput } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Backoff schedule: 2s, 4s, 8s, … capped at 5 min */
const BACKOFF_INITIAL_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;
export const PROVISIONING_BACKOFF_MAX_MS = 10_000;

/**
 * A state event is considered "recent" if its created_at is within this
 * many seconds of now. Events older than this arriving on initial page load
 * will not trigger backoff polling.
 */
const RECENT_STATE_EVENT_MAX_AGE_S = 5 * 60; // 5 minutes

// ---------------------------------------------------------------------------
// StateEventManager
// ---------------------------------------------------------------------------

/**
 * Manages the Nostr state event lifecycle for a pool.
 *
 * The pool calls update() whenever the stateEvent$ observable emits.
 * The manager tracks the current state, detects changes, and manages
 * the backoff timer for re-fetching.
 */
export class StateEventManager {
  private _currentState: StateEventInput = undefined;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffDelay = BACKOFF_INITIAL_MS;
  private maxBackoffMs = BACKOFF_MAX_MS;
  /** Unix timestamp (ms) of the next scheduled retry, or null */
  private _retryAt: number | null = null;

  /** The current state event (undefined = loading, null = none, StateEvent = have) */
  get currentState(): StateEventInput {
    return this._currentState;
  }

  /**
   * Unix timestamp (ms) of the next scheduled retry.
   * null when no retry is pending.
   */
  get retryAt(): number | null {
    return this._retryAt;
  }

  /** Change the retry ceiling without disturbing an already scheduled fetch. */
  setMaxBackoffMs(maxBackoffMs = BACKOFF_MAX_MS): void {
    this.maxBackoffMs = maxBackoffMs;
    this.backoffDelay = Math.min(this.backoffDelay, maxBackoffMs);
  }

  /**
   * Update the current state event. Called by the pool when the
   * stateEvent$ observable emits.
   */
  update(stateEvent: StateEventInput): void {
    this._currentState = stateEvent;
  }

  /**
   * Check if the given fetched refs match the current state event's refs.
   * Returns true if all refs match (or if there's no state event).
   */
  refsMatchLastFetched(fetchedRefs: Record<string, string>): boolean {
    if (!this._currentState) return true;

    const stateRefs = this._currentState.refs;
    const fetchedKeys = Object.keys(fetchedRefs);

    // Build a map from state refs for comparison
    const stateRefMap: Record<string, string> = {};
    for (const ref of stateRefs) {
      stateRefMap[ref.name] = ref.commitId;
    }

    const stateKeys = Object.keys(stateRefMap);
    if (stateKeys.length !== fetchedKeys.length) return false;

    return stateKeys.every((k) => fetchedRefs[k] === stateRefMap[k]);
  }

  /**
   * Whether the current state event is recent enough to trigger backoff
   * polling. Historical events arriving on initial load should not cause
   * polling.
   */
  isRecent(): boolean {
    if (!this._currentState) return false;
    const nowS = Math.floor(Date.now() / 1000);
    return nowS - this._currentState.createdAt <= RECENT_STATE_EVENT_MAX_AGE_S;
  }

  /**
   * Schedule a backoff re-fetch. The callback is called after the backoff
   * delay. Each call doubles the delay up to BACKOFF_MAX_MS.
   */
  scheduleBackoffFetch(callback: () => void): void {
    this.cancelBackoff();
    this._retryAt = Date.now() + this.backoffDelay;
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      this._retryAt = null;
      callback();
    }, this.backoffDelay);
    this.backoffDelay = Math.min(this.backoffDelay * 2, this.maxBackoffMs);
  }

  /** Cancel any pending backoff timer */
  cancelBackoff(): void {
    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
    this._retryAt = null;
  }

  /** Reset the backoff delay to initial (after a successful fetch) */
  resetBackoff(): void {
    this.backoffDelay = BACKOFF_INITIAL_MS;
    this._retryAt = null;
  }
}

// ---------------------------------------------------------------------------
// State-commit fetch ordering
// ---------------------------------------------------------------------------

/** The subset of a server's cached infoRefs the ordering decision needs. */
export interface CachedInfoRefs {
  symrefs: Record<string, string>;
  refs: Record<string, string>;
}

/**
 * Order servers for a fetch of the commit named by the state event.
 *
 * The announced commit need not be a branch tip: one maintainer can announce a
 * commit that another has since built on, and the server still holds that object.
 * A server whose advertised HEAD differs is therefore ranked *below* one that
 * agrees, but it must stay in the attempt - filtering it out turns a reachable
 * ancestor into "announced commit not found on any git server".
 */
export function orderStateCommitUrls(
  urls: string[],
  commitHash: string,
  peekInfoRefs: (url: string) => CachedInfoRefs | undefined,
): string[] {
  const agreeing: string[] = [];
  const rest: string[] = [];

  for (const url of urls) {
    const cached = peekInfoRefs(url);
    if (!cached) {
      // Nothing cached yet: no reason to distrust this server.
      agreeing.push(url);
      continue;
    }
    const headRef = cached.symrefs["HEAD"];
    const headCommit = headRef
      ? cached.refs[headRef]
      : Object.values(cached.refs)[0];
    if (
      !headCommit ||
      headCommit.startsWith(commitHash) ||
      commitHash.startsWith(headCommit)
    ) {
      agreeing.push(url);
      continue;
    }
    rest.push(url);
  }

  return [...agreeing, ...rest];
}
