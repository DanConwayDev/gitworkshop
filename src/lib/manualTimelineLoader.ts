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
 *
 * historyReachedArchive$ — smart inbox cutoff:
 *   After each block settles, every relay that participated is checked:
 *     - "done past archive" if its oldest delivered event <= archiveCutoff
 *     - "exhausted"         if it delivered fewer events than the block limit
 *   Relays that delivered zero events this block are also considered exhausted.
 *   If ALL relays are done by either criterion, historyReachedArchive$ is set
 *   to true. The notifications page uses this to hide "load more" on the inbox
 *   tab (where archived events are not shown anyway), while still showing it
 *   on the archived / all tabs.
 *
 *   Per-relay oldest timestamps are tracked cumulatively across blocks (not
 *   reset per block) because loadBlocksFromRelays advances the cursor — each
 *   block goes further back, so the oldest timestamp only ever decreases.
 *   Per-relay counts ARE reset per block to detect per-block exhaustion.
 */

import { BehaviorSubject, Subject } from "rxjs";
import { debounceTime, tap } from "rxjs/operators";
import { mapEventsToStore } from "applesauce-core";
import { getSeenRelays } from "applesauce-core/helpers";
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
   * True once every relay has either delivered an event older than the
   * archive cutoff or been exhausted (returned fewer events than the limit).
   * Used to hide "load more" on the inbox tab — there are no more
   * non-archived events to fetch, even if hasMore is still true.
   */
  historyReachedArchive$: BehaviorSubject<boolean>;
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
  /**
   * Returns the current archive cutoff Unix timestamp (seconds).
   * When provided, historyReachedArchive$ is set to true once every relay
   * has either gone past this cutoff or been exhausted.
   * If not provided, historyReachedArchive$ stays false permanently.
   */
  getArchiveCutoff?: () => number;
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
  const historyReachedArchive$ = new BehaviorSubject<boolean>(false);

  // Guards against concurrent loadMore() calls
  let inFlight = false;
  // Count events received in the current block; reset on each loadMore()
  let blockCount = 0;
  let blockLimit = 10;

  // Mutable filter copies — .limit is updated in-place before each window
  // push so loadBlocksFromRelays reads the correct limit for this block.
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

  // -------------------------------------------------------------------------
  // Per-relay tracking for historyReachedArchive$
  //
  // relayOldest: cumulative oldest created_at seen per relay (across all
  //   blocks). Only decreases over time as we go further back in history.
  // relayBlockCount: events delivered by each relay in the CURRENT block.
  //   Reset at the start of each loadMore() call.
  // -------------------------------------------------------------------------
  const relayOldest = new Map<string, number>();
  const relayBlockCount = new Map<string, number>();

  function checkReachedArchive(): void {
    if (!opts.getArchiveCutoff) return;
    // Already reached — no need to re-evaluate
    if (historyReachedArchive$.getValue()) return;

    const ab = opts.getArchiveCutoff();
    // If there's no meaningful archive cutoff, skip
    if (ab <= 0) return;

    // Every relay we know about must be "done":
    //   - gone past the archive cutoff (oldest event <= ab), OR
    //   - exhausted this block (delivered fewer events than the limit)
    //
    // Relays that delivered zero events this block are exhausted by definition
    // (they are in relayOldest from a previous block but not in relayBlockCount
    // for this block, OR they never delivered anything at all).
    //
    // We only evaluate relays that have delivered at least one event ever
    // (i.e. are in relayOldest). Relays that never responded are ignored —
    // they can't block the signal.
    if (relayOldest.size === 0) return;

    for (const [relay, oldest] of relayOldest) {
      const pastCutoff = oldest <= ab;
      const blockEventsForRelay = relayBlockCount.get(relay) ?? 0;
      const exhausted = blockEventsForRelay < blockLimit;
      if (!pastCutoff && !exhausted) {
        // This relay still has non-archived events — not done yet
        return;
      }
    }

    historyReachedArchive$.next(true);
  }

  const settledSub: Subscription = eventActivity$
    .pipe(debounceTime(settleMs))
    .subscribe(() => {
      inFlight = false;
      historyLoading$.next(false);
      historyHasMore$.next(blockCount >= blockLimit);
      checkReachedArchive();
    });

  // Single persistent pipeline — one loadBlocksFromRelays instance for the
  // lifetime of the loader, preserving per-relay cursor state across blocks.
  const historySub: Subscription = window$
    .pipe(
      loadBlocksFromRelays(pool, relays, mutableFilters, {}),
      tap((event) => {
        blockCount++;
        eventActivity$.next();

        // Update per-relay tracking
        const seenOn = getSeenRelays(event);
        if (seenOn) {
          for (const relay of seenOn) {
            // Oldest timestamp: take the minimum (furthest back in time)
            const prev = relayOldest.get(relay);
            if (prev === undefined || event.created_at < prev) {
              relayOldest.set(relay, event.created_at);
            }
            // Block count: increment for this block
            relayBlockCount.set(relay, (relayBlockCount.get(relay) ?? 0) + 1);
          }
        }
      }),
      mapEventsToStore(opts.eventStore),
      onlyEvents(),
    )
    .subscribe();

  return {
    historyLoading$,
    historyHasMore$,
    historyReachedArchive$,
    loadMore: (limit: number) => {
      if (inFlight) return;
      inFlight = true;
      blockCount = 0;
      blockLimit = limit;
      // Reset per-block relay counts so exhaustion is measured per block
      relayBlockCount.clear();
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
