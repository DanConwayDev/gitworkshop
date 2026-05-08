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
 *   1. A single pool.subscription() is opened (no limit, reconnect: false +
 *      defer() + retry() for lastReceivedAt-aware reconnect).
 *      This serves as both the live feed and the initial depth probe.
 *   2. Events arriving before EOSE are counted and the oldest timestamp tracked.
 *   3. After EOSE:
 *      - If count < limit: relay has no more history, nothing more to do.
 *      - If count >= limit: relay truncated its response — backward pagination
 *        is kicked off using loadBlocksFromRelay, starting from the oldest
 *        event seen, until the relay returns 0 events.
 *   4. The live subscription stays open throughout and after pagination,
 *      reconnecting automatically via defer() + retry() with exponential
 *      backoff. On reconnect, since: lastReceivedAt avoids replaying full
 *      history; eoseSeen remains true so pagination is not re-triggered.
 *
 * Reconnect behaviour (mirrors resilientSubscription):
 *   - Exponential backoff: 1s × 2^(n-1), capped at 5 minutes.
 *   - Rate-limited CLOSED: prolonged backoff (60–90s × 2^(n-1), capped at
 *     30 minutes) + shared per-relay cooldown registry so other concurrent
 *     subscriptions to the same relay also hold off.
 *   - Permanent CLOSED (restricted/blocked/pow/mute/unsupported/invalid):
 *     fast-fail immediately — no point retrying.
 *   - AuthRequired: fast-fail — handled by the pool-level auth policy.
 *   - Before first EOSE: capped at retryCount (default 3) attempts.
 *   - After first EOSE: unlimited retries (relay was reachable, treat drops
 *     as transient).
 *
 * Pagination modes:
 *   - Auto (default): pagination is triggered automatically after EOSE if the
 *     relay returned >= limit events. Continues until exhausted.
 *   - Manual (manualPaginate$ provided): automatic pagination is disabled.
 *     Each emission of manualPaginate$ requests the next backward block from
 *     all non-exhausted relays. Useful for "load more" buttons.
 *
 * EOSE settle signal:
 *   The returned observable emits NostrEvent | "EOSE". "EOSE" is emitted
 *   200ms after the first relay in the batch finishes its current work:
 *     - Auto mode: first relay whose initial EOSE count < limit (no pagination
 *       needed), or first relay whose backward pagination block completes.
 *     - Manual mode: first relay that returns its block after a manualPaginate$
 *       trigger, or immediately at relay EOSE (no pagination pending).
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
import type { RelayPool } from "applesauce-relay";
import { onlyEvents } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  bufferTime,
  catchError,
  filter,
  finalize,
  merge,
  share,
  switchMap,
  take,
} from "rxjs";
import { makeSettleSignal, DEFAULT_SETTLE_TIME } from "./settleSignal";
import type { SettleSignal, SettleSignalOptions } from "./settleSignal";
import {
  resilientSingleRelayRequest,
  resilientSubscription,
} from "./resilientSubscription";

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
  /**
   * If provided, disables automatic backward pagination. Each emission
   * requests the next block from all non-exhausted relays. Use for
   * "load more" button patterns.
   */
  manualPaginate$?: Observable<void>;
  /**
   * Number of reconnect attempts per relay before giving up (before first
   * EOSE). After first EOSE retries are unlimited. Default: 3.
   */
  retryCount?: number;
  /**
   * Gap-fill overlap buffer in seconds. Default: 600 (10 minutes).
   */
  gapFillBuffer?: number;
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
 * Process one relay stream: open a resilient live subscription and (if needed)
 * paginate backward until exhausted.
 *
 * Reconnect behaviour mirrors processRelay in resilientSubscription:
 *   - Exponential backoff, rate-limit handling, permanent error fast-fail,
 *     AuthRequired fast-fail, unlimited retries after first EOSE.
 *
 * @param signal          - settle signal; call extend/settle/error as relay
 *                          work progresses.
 * @param manualPaginate$ - if provided, disables auto-pagination; each emission
 *                         requests the next backward block from this relay.
 */
function processRelayStream(
  pool: RelayPool,
  relay: string,
  relayFilter: Filter,
  paginationFilter: TimelessFilter,
  key: string,
  limit: number,
  retryCount: number,
  gapFillBuffer: number,
  exhausted: Set<string>,
  signal: SettleSignal,
  manualPaginate$: Observable<void> | undefined,
): Observable<NostrEvent> {
  // No limit on the live filter — we want all future events.
  const liveFilter: Filter = { ...relayFilter };
  delete liveFilter.limit;

  // If already exhausted, just open the live subscription — signal settled
  // immediately since there is no history work to do.
  if (exhausted.has(key)) {
    signal.settle(relay);
    return resilientSubscription(pool, [relay], [liveFilter], {
      paginate: false,
      gapFill: true,
      settle: false,
      retryCount,
      gapFillBuffer,
    }).pipe(onlyEvents()) as Observable<NostrEvent>;
  }

  return new Observable<NostrEvent>((subscriber) => {
    let countBeforeEose = 0;
    let oldestSeen: number | undefined;
    let eoseSeen = false;
    let paginateSub: { unsubscribe(): void } | undefined;
    let manualSub: { unsubscribe(): void } | undefined;

    // Shared pagination window — driven by auto (BehaviorSubject) or manual.
    let window$: Subject<{ since?: number; until?: number }> | undefined;

    const startPagination = () => {
      // loadBlocksFromRelay is used here purely as a pagination cursor state
      // machine: it tracks the backward cursor, prevents parallel page loads,
      // and detects exhaustion (zero events returned). It does NOT perform the
      // actual relay request — that is handled by extendingPool below, which
      // replaces applesauce's internal request with resilientSingleRelayRequest
      // so every page gets our own exponential backoff and rate-limit handling
      // instead of applesauce's built-in retry logic.
      //
      // extendingPool also calls signal.extend() on every page request (not
      // just the first) to keep the signal alive while pagination is in flight.
      // The relay is fixed in the outer scope so _relays is always [relay] and
      // can be ignored.
      const extendingPool = (_relays: string[], filters: Filter[]) => {
        signal.extend(relay);
        return resilientSingleRelayRequest(pool, relay, filters, {
          retryCount,
        });
      };

      if (manualPaginate$) {
        // Manual mode: create a plain Subject; each manualPaginate$ emission
        // pushes a new window value to request the next block.
        const manualWindow$ = new Subject<{ since?: number; until?: number }>();
        window$ = manualWindow$;

        manualSub = manualPaginate$.subscribe(() => {
          if (!exhausted.has(key)) {
            manualWindow$.next({ since: -Infinity, until: oldestSeen });
          }
        });
      } else {
        // Auto mode: BehaviorSubject with initial value triggers the first
        // block immediately; loadBlocksFromRelay drives subsequent blocks
        // via its internal cursor until the relay returns 0 events.
        window$ = new BehaviorSubject<{ since?: number; until?: number }>({
          since: -Infinity,
          until: oldestSeen,
        });
      }

      paginateSub = window$
        .pipe(
          loadBlocksFromRelay(extendingPool, relay, [paginationFilter], {
            limit,
          }),
          // Relay errors during backward pagination are non-fatal — finalize
          // below still runs (on both completion and error) so signal.settle
          // is called and the relay is marked exhausted in auto mode.
          catchError(() => EMPTY),
          finalize(() => {
            if (!manualPaginate$) {
              // Auto: fully exhausted when loadBlocksFromRelay completes
              exhausted.add(key);
            }
            signal.settle(relay);
          }),
        )
        .subscribe({
          next: (event) => {
            // Track oldest seen across all blocks for manual cursor
            if (oldestSeen === undefined || event.created_at < oldestSeen) {
              oldestSeen = event.created_at;
            }
            subscriber.next(event);
          },
          // Completing does not complete the outer observable —
          // the live subscription keeps it alive
        });
    };

    // Delegate reconnect, backoff, rate-limit handling, and foreground gap-fill
    // to resilientSubscription. settle: false — we manage the outer signal
    // ourselves via onRelaySettle/onRelayError callbacks, which resilientSubscription
    // fires at every point it would normally call signal.settle/error. This
    // restores the rate-limit cooldown settle that was lost when buildResilientLiveSub
    // was replaced: if the relay is rate-limited on first connect, onRelaySettle
    // fires immediately so the EOSE signal is not blocked.
    const liveSub = resilientSubscription(pool, [relay], [liveFilter], {
      paginate: false,
      gapFill: true,
      settle: false,
      retryCount,
      gapFillBuffer,
      onRelaySettle: () => signal.settle(relay),
      onRelayError: () => signal.error(relay),
    }).subscribe({
      next: (msg) => {
        if (msg === "EOSE") {
          eoseSeen = true;
          if (manualPaginate$) {
            // Manual mode: signal settled at EOSE regardless of count —
            // the user decides when to request more
            signal.settle(relay);
            // Only start pagination machinery if there may be more history
            if (countBeforeEose >= limit) startPagination();
            else exhausted.add(key);
          } else {
            // Auto mode: paginate if relay was truncated, otherwise done
            if (countBeforeEose < limit) {
              exhausted.add(key);
              signal.settle(relay);
            } else {
              startPagination();
            }
          }
        } else {
          const event = msg as NostrEvent;
          if (!eoseSeen) {
            countBeforeEose++;
            if (oldestSeen === undefined || event.created_at < oldestSeen) {
              oldestSeen = event.created_at;
            }
          }
          subscriber.next(event);
        }
      },
      complete: () => subscriber.complete(),
    });

    return () => {
      liveSub.unsubscribe();
      paginateSub?.unsubscribe();
      manualSub?.unsubscribe();
    };
  });
}

function processBatch(
  pool: RelayPool,
  tagName: string,
  pointers: TagValuePointer[],
  opts: PaginatedTagValueLoaderOptions,
  exhausted: Set<string>,
  settleOpts: SettleSignalOptions,
): { events$: Observable<NostrEvent>; eose$: Observable<"EOSE"> } {
  const limit = opts.limit ?? 500;
  const retryCount = opts.retryCount ?? 3;
  const gapFillBuffer = opts.gapFillBuffer ?? 600;
  const relayFilterMap = buildRelayFilterMap(tagName, pointers, opts);
  const relayIds = Object.keys(relayFilterMap);

  const signal = makeSettleSignal({
    ...settleOpts,
    relayIds,
  });

  const perRelayStreams = relayIds.map((relay) => {
    const relayFilter = relayFilterMap[relay];
    const key = exhaustionKey(relay, tagName, relayFilter);
    const paginationFilter: TimelessFilter = { ...relayFilter };
    delete (paginationFilter as Filter).limit;

    return processRelayStream(
      pool,
      relay,
      relayFilter,
      paginationFilter,
      key,
      limit,
      retryCount,
      gapFillBuffer,
      exhausted,
      signal,
      opts.manualPaginate$,
    );
  });

  if (perRelayStreams.length === 0) {
    // relayIds is empty — makeSettleSignal fires eose$ immediately
    return { events$: EMPTY, eose$: signal.eose$ };
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

  return { events$: combined, eose$: signal.eose$ };
}

/**
 * Creates a paginated tag-value loader that is a drop-in replacement for
 * applesauce's createTagValueLoader.
 *
 * Returns Observable<NostrEvent | "EOSE">. Pipe through onlyEvents() if
 * the EOSE signal is not needed.
 *
 * - Batches pointers by bufferTime/bufferSize (same as createTagValueLoader)
 * - Opens a resilient live subscription per relay with exponential backoff,
 *   rate-limit handling, and permanent error fast-fail
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
  const settleMs = opts.settleTime ?? DEFAULT_SETTLE_TIME;

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

      // Per-batch settle signal — created inside processBatch with relay count
      const settleOpts: SettleSignalOptions = { settleTime: settleMs };

      const { events$, eose$ } = processBatch(
        pool,
        tagName,
        pointers,
        opts,
        exhausted,
        settleOpts,
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
                (msg: PaginatedTagValueResponse) =>
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
