/**
 * resilientSubscription
 *
 * A wrapper around pool.subscription() that provides:
 *
 *   A. lastReceivedAt-aware reconnect — uses defer() + retry() so that on
 *      reconnect we inject since: lastReceivedAt - gapFillBuffer instead of
 *      replaying the full relay history. Same pattern as processRelayStream
 *      in tagValuePaginatedLoader.ts.
 *
 *   B. Foreground resume gap-fill — subscribes to foregroundResume$. On
 *      resume, fires a one-shot REQ with since: lastReceivedAt - gapFillBuffer
 *      and merges results into the main stream.
 *
 *   C. EOSE settle signal — emits "EOSE" after a debounce window once all
 *      relays have signalled EOSE. Uses makeSettleSignal from settleSignal.ts.
 *
 *   D. Backward pagination (opt-in) — after EOSE, if countBeforeEose >= limit,
 *      kicks off loadBlocksFromRelay backward pagination per relay. Supports
 *      auto mode and manual mode (via manualPaginate$).
 *
 * The function opens a per-relay pipeline for each relay URL (like
 * processRelayStream does), merges them, and shares the settle signal.
 *
 * IMPORTANT: resilientSubscription does NOT add mapEventsToStore or
 * filterDuplicateEvents. Callers pipe those themselves. The function returns
 * raw NostrEvent | "EOSE" and callers use onlyEvents() to strip EOSE if not
 * needed.
 */

import type { RelayPool } from "applesauce-relay";
import { completeOnEose, onlyEvents } from "applesauce-relay";
import type { Filter } from "applesauce-core/helpers";
import { loadBlocksFromRelay } from "applesauce-loaders/loaders";
import type { TimelessFilter } from "applesauce-loaders";
import type { NostrEvent } from "nostr-tools";
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  defer,
  finalize,
  merge,
  retry,
  tap,
} from "rxjs";
import { makeSettleSignal, DEFAULT_SETTLE_TIME } from "./settleSignal";
import { foregroundResume$ } from "./foregroundResume";

export interface ResilientSubscriptionOptions {
  /** Enable smart reconnect with since: lastReceivedAt. Default: true */
  reconnect?: boolean;
  /** Enable gap-fill on foreground resume. Default: true */
  gapFill?: boolean;
  /** Gap-fill overlap buffer in seconds. Default: 600 (10 minutes) */
  gapFillBuffer?: number;
  /** Enable EOSE settle signal. Default: true */
  settle?: boolean;
  /** Settle debounce window in ms. Default: 200 */
  settleTime?: number;
  /** Enable automatic backward pagination after EOSE. Default: false */
  paginate?: boolean;
  /** Manual pagination trigger. When provided, auto-pagination is disabled. */
  manualPaginate$?: Observable<void>;
  /** Pagination block size / threshold. Default: 500 */
  limit?: number;
}

export type ResilientSubscriptionResponse = NostrEvent | "EOSE";

/**
 * Per-relay pipeline — mirrors processRelayStream from tagValuePaginatedLoader.
 * Returns an Observable<NostrEvent> that stays alive as long as the relay is
 * connected (or retrying). Pushes to settled$ when the relay finishes its
 * current work.
 */
function processRelay(
  pool: RelayPool,
  relay: string,
  filters: Filter[],
  opts: Required<
    Pick<
      ResilientSubscriptionOptions,
      "reconnect" | "gapFill" | "gapFillBuffer" | "paginate" | "limit"
    >
  > & { manualPaginate$: Observable<void> | undefined },
  settled$: Subject<void>,
): Observable<NostrEvent> {
  const limit = opts.limit;

  // Live filters: strip limit so we get all future events.
  const liveFilters: Filter[] = filters.map((f) => {
    const lf = { ...f };
    delete lf.limit;
    return lf;
  });

  // Pagination filters: strip since/until (TimelessFilter).
  const paginationFilters: TimelessFilter[] = filters.map((f) => {
    const pf: TimelessFilter = { ...f };
    delete (pf as Filter).since;
    delete (pf as Filter).until;
    delete (pf as Filter).limit;
    return pf;
  });

  return new Observable<NostrEvent>((subscriber) => {
    let countBeforeEose = 0;
    let oldestSeen: number | undefined;
    let lastReceivedAt: number | undefined;
    let eoseSeen = false;
    let paginateSub: { unsubscribe(): void } | undefined;
    let manualSub: { unsubscribe(): void } | undefined;
    let gapFillSub: { unsubscribe(): void } | undefined;

    // Shared pagination window — driven by auto (BehaviorSubject) or manual.
    let window$: Subject<{ since?: number; until?: number }> | undefined;

    const startPagination = () => {
      if (opts.manualPaginate$) {
        const manualWindow$ = new Subject<{ since?: number; until?: number }>();
        window$ = manualWindow$;
        manualSub = opts.manualPaginate$.subscribe(() => {
          manualWindow$.next({ since: -Infinity, until: oldestSeen });
        });
      } else {
        window$ = new BehaviorSubject<{ since?: number; until?: number }>({
          since: -Infinity,
          until: oldestSeen,
        });
      }

      paginateSub = window$
        .pipe(
          loadBlocksFromRelay(pool, relay, paginationFilters, { limit }),
          finalize(() => {
            settled$.next();
          }),
        )
        .subscribe({
          next: (event) => {
            if (oldestSeen === undefined || event.created_at < oldestSeen) {
              oldestSeen = event.created_at;
            }
            subscriber.next(event);
          },
          error: (err) => subscriber.error(err),
        });
    };

    // Build the live subscription factory. defer() re-executes on each retry
    // so lastReceivedAt is read fresh on each reconnect attempt.
    const buildLiveSub = () => {
      const filtersWithSince: Filter[] = liveFilters.map((f) => ({
        ...f,
        ...(opts.reconnect && lastReceivedAt !== undefined
          ? { since: lastReceivedAt - opts.gapFillBuffer }
          : {}),
      }));
      return pool.subscription([relay], filtersWithSince, {
        reconnect: false,
      });
    };

    const liveSub = defer(buildLiveSub)
      .pipe(
        tap((msg) => {
          if (msg !== "EOSE") {
            const t = (msg as NostrEvent).created_at;
            if (lastReceivedAt === undefined || t > lastReceivedAt)
              lastReceivedAt = t;
          }
        }),
        retry({ count: 3, delay: 1000, resetOnSuccess: true }),
      )
      .subscribe({
        next: (msg) => {
          if (msg === "EOSE") {
            eoseSeen = true;
            if (opts.paginate || opts.manualPaginate$) {
              if (opts.manualPaginate$) {
                // Manual mode: signal settled at EOSE; start pagination if needed
                settled$.next();
                if (countBeforeEose >= limit) startPagination();
              } else {
                // Auto mode: paginate if relay was truncated
                if (countBeforeEose < limit) {
                  settled$.next();
                } else {
                  startPagination();
                }
              }
            } else {
              settled$.next();
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
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });

    // Foreground resume gap-fill
    const gapFillResumeSub = opts.gapFill
      ? foregroundResume$.subscribe(() => {
          if (lastReceivedAt === undefined) return;
          gapFillSub?.unsubscribe();
          const gapFilters: Filter[] = liveFilters.map((f) => ({
            ...f,
            since: lastReceivedAt! - opts.gapFillBuffer,
          }));
          gapFillSub = pool
            .subscription([relay], gapFilters, { reconnect: false })
            .pipe(completeOnEose(), onlyEvents())
            .subscribe({
              next: (event) => subscriber.next(event),
              error: () => {
                /* gap-fill errors are non-fatal */
              },
            });
        })
      : { unsubscribe: () => {} };

    return () => {
      liveSub.unsubscribe();
      paginateSub?.unsubscribe();
      manualSub?.unsubscribe();
      gapFillSub?.unsubscribe();
      gapFillResumeSub.unsubscribe();
    };
  });
}

/**
 * Wraps pool.subscription() with smart reconnect, foreground resume gap-fill,
 * EOSE settle signal, and optional backward pagination.
 *
 * Returns Observable<NostrEvent | "EOSE">. Pipe through onlyEvents() if the
 * EOSE signal is not needed.
 *
 * Does NOT add mapEventsToStore or filterDuplicateEvents — callers handle that.
 */
export function resilientSubscription(
  pool: RelayPool,
  relays: string[],
  filters: Filter[],
  opts: ResilientSubscriptionOptions = {},
): Observable<ResilientSubscriptionResponse> {
  const reconnect = opts.reconnect ?? true;
  const gapFill = opts.gapFill ?? true;
  const gapFillBuffer = opts.gapFillBuffer ?? 600;
  const settle = opts.settle ?? true;
  const settleTime = opts.settleTime ?? DEFAULT_SETTLE_TIME;
  const paginate = opts.paginate ?? false;
  const limit = opts.limit ?? 500;
  const manualPaginate$ = opts.manualPaginate$;

  if (relays.length === 0) return EMPTY;

  const resolvedOpts = {
    reconnect,
    gapFill,
    gapFillBuffer,
    paginate,
    limit,
    manualPaginate$,
  };

  if (!settle) {
    // No settle signal — just merge per-relay streams
    const perRelayStreams = relays.map((relay) => {
      const dummySettled$ = new Subject<void>();
      return processRelay(pool, relay, filters, resolvedOpts, dummySettled$);
    });
    return merge(...perRelayStreams);
  }

  // With settle signal: share a single settled$ across all relays
  const { settled$, eose$ } = makeSettleSignal(settleTime);

  const perRelayStreams = relays.map((relay) =>
    processRelay(pool, relay, filters, resolvedOpts, settled$),
  );

  return merge(merge(...perRelayStreams), eose$);
}
