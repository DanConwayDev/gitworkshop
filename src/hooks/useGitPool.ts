/**
 * useGitPool — React hook for git-grasp-pool
 *
 * Returns a stable PoolState that updates reactively whenever the pool emits.
 * The pool instance itself is long-lived and must NOT be used as a React
 * dependency — use pool.subscribe() or pool.observable with use$ instead.
 *
 * Multiple components calling this hook with the same clone URLs share one
 * pool instance (via the registry).
 */

import { useState, useEffect, useRef } from "react";
import { getOrCreatePool } from "@/lib/git-grasp-pool";
import type { PoolState, StateEventInput } from "@/lib/git-grasp-pool";
import type { Observable } from "rxjs";

export interface UseGitPoolOptions {
  /**
   * Observable that emits the current Nostr state event for this repo.
   * - undefined = still loading
   * - null = confirmed no state event
   * - StateEvent = have state event data
   *
   * The observable reference must be stable (created outside the render cycle
   * or memoised) — it is only read on the first mount and when cloneUrls change.
   */
  stateEvent$?: Observable<StateEventInput>;
}

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
  };
}

/**
 * Subscribe to a GitGraspPool for the given clone URLs.
 *
 * Returns a reactive PoolState snapshot that updates as data arrives.
 * Multiple hook instances with the same clone URLs share one pool.
 */
export function useGitPool(
  cloneUrls: string[],
  options: UseGitPoolOptions = {},
): PoolState {
  const { stateEvent$ } = options;

  const urlsKey = cloneUrls.join(",");

  const [state, setState] = useState<PoolState>(() =>
    makeInitialState(cloneUrls.length > 0),
  );

  // Hold a ref to the stateEvent$ observable so we can pass it to the pool
  // on first creation without making it a useEffect dependency (which would
  // cause unnecessary re-subscriptions if the observable reference changes).
  const stateEvent$Ref = useRef(stateEvent$);
  stateEvent$Ref.current = stateEvent$;

  useEffect(() => {
    if (cloneUrls.length === 0) {
      setState(makeInitialState(false));
      return;
    }

    const pool = getOrCreatePool({
      cloneUrls,
      stateEvent$: stateEvent$Ref.current,
    });

    // Deliver current state immediately, then subscribe to updates.
    // pool.subscribe() handles the initial fetch trigger internally.
    const unsubscribe = pool.subscribe((newState) => {
      setState(newState);
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  return state;
}
