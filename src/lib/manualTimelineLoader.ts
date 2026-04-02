/**
 * createManualTimelineLoader
 *
 * A manual-paged timeline loader built on applesauce's loadBlocksFromRelays.
 * Each call to loadMore(limit) fetches one block going backwards across all
 * relays. Per-relay cursors are tracked inside the single persistent
 * loadBlocksFromRelays operator instance — so each block starts exactly where
 * the previous one left off, even when the limit changes between calls.
 *
 * Limit per block:
 *   loadBlocksFromRelays closes over the filters array by reference and calls
 *   mergeFilters(f, base) on each window push, reading f.limit fresh each
 *   time. We hold a mutable copy of the filters and update .limit in-place
 *   before each window push so the relay sees the correct limit per block.
 *   This lets the badge call loadMore(10) and the page call loadMore(200)
 *   through the same persistent loader without resetting the cursor.
 *
 * EOSE / settle signal:
 *   Each arriving event resets a debounce timer. When no events arrive for
 *   settleMs after the first event of a block, the block is considered done.
 *   This naturally handles multiple relays — the debounce waits for the
 *   last relay to deliver its final event before flipping historyLoading$ off.
 *   debounceTime(settleMs) fires after the first relay to go quiet, giving
 *   other relays a chance to catch up.
 *
 * hasMore heuristic:
 *   If the total event count across all relays for a block is >= the requested
 *   limit, there is probably more history. If < limit, the button is hidden.
 */

import { BehaviorSubject, Subject } from "rxjs";
import { debounceTime, tap } from "rxjs/operators";
import { mapEventsToStore } from "applesauce-core";
import { loadBlocksFromRelays } from "applesauce-loaders/loaders";
import { onlyEvents } from "applesauce-relay";
import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { TimelessFilter } from "applesauce-loaders";
import type { Subscription } from "rxjs";

export interface ManualTimelineLoader {
  /** True while a loadMore() block is in-flight */
  historyLoading$: BehaviorSubject<boolean>;
  /**
   * True after a block completes with count >= the requested limit.
   * False when the block returned fewer events (bottom reached) or before
   * the first loadMore() call.
   */
  historyHasMore$: BehaviorSubject<boolean>;
  /**
   * Fetch the next block of historical events going backwards.
   * Ignored if a block is already in-flight.
   * @param limit - events to request per relay this block
   */
  loadMore: (limit: number) => void;
  /** Tear down all subscriptions */
  destroy: () => void;
}

export interface ManualTimelineLoaderOptions {
  /** EventStore to add events to */
  eventStore: EventStore;
  /**
   * Debounce window in ms before flipping historyLoading$ to false after
   * the first relay finishes its block (default 200).
   */
  settleTime?: number;
}

export function createManualTimelineLoader(
  pool: RelayPool,
  relays: string[],
  filters: TimelessFilter[],
  opts: ManualTimelineLoaderOptions,
): ManualTimelineLoader {
  const settleMs = opts.settleTime ?? 200;

  const historyLoading$ = new BehaviorSubject<boolean>(false);
  const historyHasMore$ = new BehaviorSubject<boolean>(false);

  // Guards against concurrent loadMore() calls
  let inFlight = false;
  // Count events received in the current block; reset on each loadMore()
  let blockCount = 0;
  let blockLimit = 10;

  // Mutable filter copies — .limit is updated in-place before each window
  // push so loadBlocksFromRelays reads the correct limit per block.
  const mutableFilters: (TimelessFilter & { limit?: number })[] = filters.map(
    (f) => ({ ...f }),
  );

  // Pushing { since: -Infinity } triggers the next backward block from each
  // relay's internal cursor. One persistent Subject drives the whole lifetime
  // of the loader — the cursor state lives inside loadBlocksFromRelays.
  const window$ = new Subject<{ since?: number; until?: number }>();

  // Each arriving event resets this debounce. When quiet for settleMs the
  // block is considered done and we flip the loading state.
  const eventActivity$ = new Subject<void>();

  const settledSub: Subscription = eventActivity$
    .pipe(debounceTime(settleMs))
    .subscribe(() => {
      inFlight = false;
      historyLoading$.next(false);
      historyHasMore$.next(blockCount >= blockLimit);
    });

  // Single persistent pipeline — one loadBlocksFromRelays instance for the
  // lifetime of the loader, preserving per-relay cursor state across blocks.
  const historySub: Subscription = window$
    .pipe(
      loadBlocksFromRelays(pool, relays, mutableFilters, {}),
      tap(() => {
        blockCount++;
        eventActivity$.next();
      }),
      mapEventsToStore(opts.eventStore),
      onlyEvents(),
    )
    .subscribe();

  return {
    historyLoading$,
    historyHasMore$,
    loadMore: (limit: number) => {
      if (inFlight) return;
      inFlight = true;
      blockCount = 0;
      blockLimit = limit;
      // Update limit on all filters before the window push so the relay REQ
      // is built with the correct limit for this block.
      for (const f of mutableFilters) {
        f.limit = limit;
      }
      historyLoading$.next(true);
      window$.next({ since: -Infinity });
    },
    destroy: () => {
      settledSub.unsubscribe();
      historySub.unsubscribe();
      window$.complete();
      eventActivity$.complete();
    },
  };
}
