/**
 * useGitPool — the single React hook for git-grasp-pool.
 *
 * Subscribes to a GitGraspPool for the given clone URLs and returns the
 * reactive PoolState plus the pool instance for imperative operations
 * (getTree, getBlob, getSingleCommit, etc.).
 *
 * Multiple components calling this hook with the same clone URLs share one
 * pool instance via the registry. The pool's fetch is triggered on first
 * subscribe and kept alive for the component's lifetime.
 *
 * State event integration:
 *   Pass knownHeadCommit + stateRefs + stateCreatedAt from the Nostr state
 *   event (kind:30618). The hook builds a BehaviorSubject internally and
 *   pushes updates into it whenever those values change — the pool reacts
 *   to the observable and schedules re-fetches as needed.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { BehaviorSubject } from "rxjs";
import { getOrCreatePool } from "@/lib/git-grasp-pool";
import type {
  GitGraspPool,
  PoolState,
  StateEventInput,
  StateEvent,
} from "@/lib/git-grasp-pool";
import type { RepoStateRef } from "@/lib/nip34";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UseGitPoolOptions {
  /**
   * HEAD commit declared by the Nostr state event (kind:30618).
   * undefined = still loading from relays; omit when no state event exists.
   */
  knownHeadCommit?: string;
  /** All refs declared by the state event. */
  stateRefs?: RepoStateRef[];
  /** created_at of the state event (seconds). */
  stateCreatedAt?: number;
}

// ---------------------------------------------------------------------------
// Initial state helper
// ---------------------------------------------------------------------------

function makeInitialState(hasUrls: boolean): PoolState {
  return {
    urls: {},
    winnerUrl: null,
    health: "idle",
    loading: hasUrls,
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
// Hook
// ---------------------------------------------------------------------------

export interface UseGitPoolResult {
  /** Reactive snapshot of the pool state — updates as data arrives. */
  poolState: PoolState;
  /**
   * The pool instance for imperative operations (getTree, getBlob, etc.).
   * Stable reference — safe to use in useEffect dependency arrays.
   * null only when cloneUrls is empty.
   */
  pool: GitGraspPool | null;
}

/**
 * Subscribe to a GitGraspPool for the given clone URLs.
 *
 * Returns reactive PoolState and the pool instance for imperative git ops.
 * Multiple hook instances with the same clone URLs share one pool.
 */
export function useGitPool(
  cloneUrls: string[],
  options: UseGitPoolOptions = {},
): UseGitPoolResult {
  const { knownHeadCommit, stateRefs, stateCreatedAt } = options;

  const urlsKey = cloneUrls.join(",");

  // Stable key for the state event so we can detect changes without
  // deep-comparing the refs array on every render.
  const refsKey = stateRefs
    ? stateRefs
        .map((r) => `${r.name}:${r.commitId}`)
        .sort()
        .join(",")
    : "";

  // Build the StateEvent value from options.
  // undefined = still loading (no head commit yet)
  // null = confirmed no state event (not used here — callers just omit options)
  const currentStateEvent = useMemo<StateEventInput>(() => {
    if (!knownHeadCommit) return undefined;
    const refs = stateRefs ?? [];
    if (refs.length === 0) return undefined;
    return {
      headCommitId: knownHeadCommit,
      refs: refs.map((r) => ({ name: r.name, commitId: r.commitId })),
      createdAt: stateCreatedAt ?? 0,
    } satisfies StateEvent;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownHeadCommit, refsKey, stateCreatedAt]);

  // The BehaviorSubject lives for the lifetime of the subscription (tied to
  // urlsKey). We push new state event values into it whenever they change.
  const stateSubjectRef = useRef<BehaviorSubject<StateEventInput> | null>(null);

  // Push state event updates synchronously (before effects run) so the pool
  // sees the latest value as soon as it changes.
  const prevRefsKey = useRef<string>("");
  if (refsKey !== prevRefsKey.current) {
    prevRefsKey.current = refsKey;
    stateSubjectRef.current?.next(currentStateEvent);
  }

  const [poolState, setPoolState] = useState<PoolState>(() =>
    makeInitialState(cloneUrls.length > 0),
  );

  // Stable pool ref — updated inside the effect, read by callers.
  const poolRef = useRef<GitGraspPool | null>(null);

  useEffect(() => {
    if (cloneUrls.length === 0) {
      setPoolState(makeInitialState(false));
      stateSubjectRef.current = null;
      poolRef.current = null;
      return;
    }

    // Fresh subject seeded with the current state event value.
    const subject = new BehaviorSubject<StateEventInput>(currentStateEvent);
    stateSubjectRef.current = subject;

    const pool = getOrCreatePool({
      cloneUrls,
      stateEvent$: subject.asObservable(),
    });
    poolRef.current = pool;

    // pool.subscribe() triggers the initial fetch and delivers current state
    // immediately, then calls back on every subsequent update.
    const unsubscribe = pool.subscribe((newState) => {
      setPoolState(newState);
    });

    return () => {
      unsubscribe();
      stateSubjectRef.current = null;
      // Don't complete the subject — the pool may still be alive for other
      // subscribers. Just drop our reference.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  return { poolState, pool: poolRef.current };
}
