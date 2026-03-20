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

  /** The current state event (undefined = loading, null = none, StateEvent = have) */
  get currentState(): StateEventInput {
    return this._currentState;
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
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      callback();
    }, this.backoffDelay);
    this.backoffDelay = Math.min(this.backoffDelay * 2, BACKOFF_MAX_MS);
  }

  /** Cancel any pending backoff timer */
  cancelBackoff(): void {
    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
  }

  /** Reset the backoff delay to initial (after a successful fetch) */
  resetBackoff(): void {
    this.backoffDelay = BACKOFF_INITIAL_MS;
  }
}
