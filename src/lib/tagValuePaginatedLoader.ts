/**
 * createPaginatedTagValueLoader
 *
 * A drop-in replacement for applesauce's createTagValueLoader that adds
 * per-relay backward pagination, a persistent live subscription, and an
 * idiomatic EOSE settle signal.
 *
 * Batching behaviour is identical to createTagValueLoader:
 *   - Incoming pointers are buffered by time (bufferTime) and size (bufferSize)
 *   - All pointers in a window are merged into one filter per relay URL
 *
 * Per relay, for each batch window:
 *   1. A single pool.subscription() is opened (no limit, reconnect: Infinity).
 *      This serves as both the live feed and the initial depth probe.
 *   2. Events arriving before EOSE are counted and the oldest timestamp tracked.
 *   3. After EOSE:
 *      - If count < limit: relay has no more history, nothing more to do.
 *      - If count >= limit: relay truncated its response — backward pagination
 *        is kicked off using loadBlocksFromRelay, starting from the oldest
 *        event seen, until the relay returns 0 events.
 *   4. The live subscription stays open throughout and after pagination,
 *      reconnecting automatically on disconnect (reconnect: Infinity).
 *      On reconnect the relay replays recent history; eoseSeen remains true
 *      so pagination is not re-triggered.
 *
 * EOSE settle signal:
 *   The returned observable emits NostrEvent | "EOSE". "EOSE" is emitted
 *   200ms after the first relay in the batch finishes its current work:
 *     - Auto mode: first relay whose initial EOSE count < limit (no pagination
 *       needed), or first relay whose backward pagination block completes.
 *     - The 200ms debounce gives other relays a chance to deliver events
 *       before the consumer considers the load "settled".
 *   Consumers that don't need the signal can pipe through onlyEvents().
 *
 * Exhaustion tracking (in-memory, resets on page reload):
 *   - Once pagination completes (or is skipped) for a relay+batch combo,
 *     the key is added to the exhausted set.
 *   - If the same set of tag values is re-queued in a later buffer window
 *     (e.g. component unmount/remount), the exhausted relay skips pagination
 *     and only opens the live subscription.
 */

import { filterDuplicateEvents, mapEventsToStore } from "applesauce-core";
import { mergeRelaySets } from "applesauce-core/helpers/relays";
import type { Filter } from "applesauce-core/helpers";
import type { EventStore } from "applesauce-core";
import { loadBlocksFromRelay } from "applesauce-loaders/loaders";
import type { TagValuePointer } from "applesauce-loaders/loaders";
import type { CacheRequest, TimelessFilter } from "applesauce-loaders";
import { makeCacheRequest } from "applesauce-loaders/helpers";
import type { RelayPool, SubscriptionOptions } from "applesauce-relay";
import { onlyEvents } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  bufferTime,
  debounceTime,
  filter,
  finalize,
  map,
  merge,
  share,
  switchMap,
  take,
} from "rxjs";

export type { TagValuePointer };

/** Response type — mirrors applesauce's SubscriptionResponse pattern */
export type PaginatedTagValueResponse = NostrEvent | "EOSE";

export type PaginatedTagValueLoaderOptions = {
  /** Time window to batch incoming pointers in ms (default 1000) */
  bufferTime?: number;
  /** Max pointers per batch window (default 200) */
  bufferSize?: number;
  /** Restrict to specific kinds */
  kinds?: number[];
  /** Number of events to request per block — also the pagination threshold (default 500) */
  limit?: number;
  /** EventStore for deduplication and storage */
  eventStore?: EventStore;
  /** Extra relays to always include */
  extraRelays?: string[];
  /** Method used to load from the cache */
  cacheRequest?: CacheRequest;
  /**
   * Debounce window in ms before emitting "EOSE" after the first relay
   * finishes its current work (default 200).
   */
  settleTime?: number;
};

export type PaginatedTagValueLoader = (
  pointer: TagValuePointer,
) => Observable<PaginatedTagValueResponse>;

/**
 * Build a per-relay filter map from a batch of pointers.
 * Returns Record<relayUrl, Filter> with all tag values merged per relay.
 */
function buildRelayFilterMap(
  tagName: string,
  pointers: TagValuePointer[],
  opts: PaginatedTagValueLoaderOptions,
): Record<string, Filter> {
  const filterTag = `#${tagName}` as keyof Filter;

  return pointers.reduce<Record<string, Filter>>((map, pointer) => {
    const relays = mergeRelaySets(pointer.relays, opts.extraRelays);
    for (const relay of relays) {
      if (!map[relay]) {
        const f: Filter = { [filterTag]: [pointer.value] };
        if (opts.kinds) f.kinds = opts.kinds;
        if (opts.limit) f.limit = opts.limit;
        map[relay] = f;
      } else {
        (map[relay][filterTag] as string[]).push(pointer.value);
      }
    }
    return map;
  }, {});
}

/**
 * Derive a stable exhaustion key for a relay + filter combination.
 * Sorts tag values so order doesn't matter.
 */
function exhaustionKey(relay: string, tagName: string, f: Filter): string {
  const filterTag = `#${tagName}`;
  const values = ((f[filterTag as keyof Filter] as string[]) ?? [])
    .slice()
    .sort()
    .join(",");
  const kinds = (f.kinds ?? []).slice().sort().join(",");
  return `${relay}::${kinds}::${values}`;
}

/**
 * Process one batch window: for each relay in the filter map, open a live
 * subscription and (if needed) paginate backward until exhausted.
 *
 * @param settled$ - push to this when a relay finishes its current work;
 *                   the caller debounces it to emit "EOSE" into the stream.
 */
function processBatch(
  pool: RelayPool,
  tagName: string,
  pointers: TagValuePointer[],
  opts: PaginatedTagValueLoaderOptions,
  exhausted: Set<string>,
  settled$: Subject<void>,
): Observable<NostrEvent> {
  const limit = opts.limit ?? 500;
  const subOpts: SubscriptionOptions = { reconnect: Infinity };
  const relayFilterMap = buildRelayFilterMap(tagName, pointers, opts);

  const perRelayStreams = Object.entries(relayFilterMap).map(
    ([relay, relayFilter]) => {
      const key = exhaustionKey(relay, tagName, relayFilter);

      // No limit on the live filter — we want all future events.
      const liveFilter: Filter = { ...relayFilter };
      delete liveFilter.limit;

      // If already exhausted, just open the live subscription — signal settled
      // immediately since there is no history work to do.
      if (exhausted.has(key)) {
        settled$.next();
        return pool
          .subscription([relay], [liveFilter], subOpts)
          .pipe(onlyEvents()) as Observable<NostrEvent>;
      }

      // TimelessFilter for loadBlocksFromRelay (no since/until — it adds them)
      const paginationFilter: TimelessFilter = { ...liveFilter };

      // Open one subscription that serves as both live feed and initial probe.
      // We count events arriving before EOSE to decide whether to paginate.
      return new Observable<NostrEvent>((subscriber) => {
        let countBeforeEose = 0;
        let oldestSeen: number | undefined;
        let eoseSeen = false;
        let paginateSub: { unsubscribe(): void } | undefined;

        const liveSub = pool
          .subscription([relay], [liveFilter], subOpts)
          .subscribe({
            next: (msg) => {
              if (msg === "EOSE") {
                eoseSeen = true;
                if (countBeforeEose < limit) {
                  // Relay has no more history — mark exhausted and signal settled
                  exhausted.add(key);
                  settled$.next();
                  return;
                }
                // Relay was truncated — paginate backward from oldest seen
                const window$ = new BehaviorSubject<{
                  since?: number;
                  until?: number;
                }>({
                  since: -Infinity,
                  until: oldestSeen,
                });

                paginateSub = window$
                  .pipe(
                    loadBlocksFromRelay(pool, relay, [paginationFilter], {
                      limit,
                    }),
                    finalize(() => {
                      exhausted.add(key);
                      // Signal settled after each completed pagination block
                      settled$.next();
                    }),
                  )
                  .subscribe({
                    next: (event) => subscriber.next(event),
                    error: (err) => subscriber.error(err),
                    // pagination completing does not complete the outer observable —
                    // the live subscription keeps it alive
                  });
              } else {
                // It's a NostrEvent
                const event = msg as NostrEvent;
                if (!eoseSeen) {
                  // Pre-EOSE: count and track oldest for pagination cursor
                  countBeforeEose++;
                  if (
                    oldestSeen === undefined ||
                    event.created_at < oldestSeen
                  ) {
                    oldestSeen = event.created_at;
                  }
                }
                subscriber.next(event);
              }
            },
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });

        return () => {
          liveSub.unsubscribe();
          paginateSub?.unsubscribe();
        };
      });
    },
  );

  if (perRelayStreams.length === 0) {
    settled$.next();
    return EMPTY;
  }

  let combined: Observable<NostrEvent> = merge(...perRelayStreams);

  // Cache load (fire and forget alongside relay streams)
  if (opts.cacheRequest) {
    const filterTag = `#${tagName}` as keyof Filter;
    const allValues = pointers.map((p) => p.value);
    const cacheFilter: Filter = { [filterTag]: allValues };
    if (opts.kinds) cacheFilter.kinds = opts.kinds;
    const cache$ = makeCacheRequest(opts.cacheRequest, [
      cacheFilter,
    ]) as Observable<NostrEvent>;
    combined = merge(combined, cache$);
  }

  if (opts.eventStore) {
    combined = combined.pipe(
      mapEventsToStore(opts.eventStore),
      filterDuplicateEvents(opts.eventStore),
    ) as Observable<NostrEvent>;
  }

  return combined;
}

/**
 * Creates a paginated tag-value loader that is a drop-in replacement for
 * applesauce's createTagValueLoader.
 *
 * Returns Observable<NostrEvent | "EOSE">. Pipe through onlyEvents() if
 * the EOSE signal is not needed.
 *
 * - Batches pointers by bufferTime/bufferSize (same as createTagValueLoader)
 * - Opens a live subscription per relay (reconnect: Infinity)
 * - Paginates backward per relay until exhausted
 * - Skips already-exhausted relay+batch combos on subsequent calls
 * - Emits "EOSE" settleTime ms after the first relay finishes its current work
 */
export function createPaginatedTagValueLoader(
  pool: RelayPool,
  tagName: string,
  opts: PaginatedTagValueLoaderOptions = {},
): PaginatedTagValueLoader {
  const bufferMs = opts.bufferTime ?? 1000;
  const bufferMax = opts.bufferSize ?? 200;
  const settleMs = opts.settleTime ?? 200;

  // In-memory exhaustion tracking — resets on page reload
  const exhausted = new Set<string>();

  // Incoming pointer queue
  const queue = new Subject<TagValuePointer>();

  // Emits one shared observable per batch window
  const next = new Subject<Observable<PaginatedTagValueResponse>>();

  // Process each buffer window
  queue
    .pipe(bufferTime(bufferMs, undefined, bufferMax))
    .subscribe((pointers) => {
      if (pointers.length === 0) return;

      // Per-batch settle signal — any relay finishing its work pushes here
      const settled$ = new Subject<void>();

      // EOSE stream: debounce settle signals then map to "EOSE" sentinel
      const eose$: Observable<PaginatedTagValueResponse> = settled$.pipe(
        debounceTime(settleMs),
        map(() => "EOSE" as const),
      );

      const events$ = processBatch(
        pool,
        tagName,
        pointers,
        opts,
        exhausted,
        settled$,
      );

      const upstream: Observable<PaginatedTagValueResponse> = merge(
        events$,
        eose$,
      ).pipe(
        // Keep alive as long as at least one caller is subscribed
        share({ resetOnRefCountZero: true }),
      );

      next.next(upstream);
    });

  return (pointer: TagValuePointer): Observable<PaginatedTagValueResponse> =>
    new Observable<PaginatedTagValueResponse>((observer) => {
      queue.next(pointer);

      const sub = next
        .pipe(
          take(1),
          switchMap((batchObs) =>
            batchObs.pipe(
              // Pass "EOSE" through; filter events to only those relevant to
              // this pointer's tag value
              filter(
                (msg) =>
                  msg === "EOSE" ||
                  msg.tags.some(
                    (tag) => tag[0] === tagName && tag[1] === pointer.value,
                  ),
              ),
            ),
          ),
        )
        .subscribe(observer);

      return () => sub.unsubscribe();
    });
}
