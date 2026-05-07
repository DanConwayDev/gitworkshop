/**
 * resilientSubscription
 *
 * A wrapper around pool.subscription() that provides:
 *
 *   A. lastReceivedAt-aware reconnect — uses defer() + retry() + repeat() so
 *      that on reconnect (whether from an error or a graceful relay close) we
 *      inject since: lastReceivedAt - gapFillBuffer instead of replaying the
 *      full relay history. Same pattern as processRelayStream in
 *      tagValuePaginatedLoader.ts.
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
import {
  completeOnEose,
  onlyEvents,
  AuthRequiredError,
  RelayClosedError,
} from "applesauce-relay";
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
  repeat,
  retry,
  tap,
  timer,
  catchError,
} from "rxjs";
import { makeSettleSignal, DEFAULT_SETTLE_TIME } from "./settleSignal";
import type { SettleSignal, SettleSignalOptions } from "./settleSignal";
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
  /**
   * Number of reconnect attempts per relay before giving up. Default: 3.
   * Applies to both error retries and graceful-close repeats.
   * Pass Infinity for always-on subscriptions that should never stop retrying.
   */
  retryCount?: number;
  /**
   * Delay between reconnect attempts. Accepts a number (ms) or a function.
   * Used for both error retries (retry operator) and graceful-close repeats
   * (repeat operator). The function receives (error, attemptCount) for errors
   * and (repeatCount) for graceful closes — both are 1-based.
   * Default: exponential backoff capped at 5 minutes (1s, 2s, 4s, 8s … 300s).
   */
  retryDelay?:
    | number
    | ((error: unknown, retryCount: number) => ReturnType<typeof timer>);
}

/**
 * Default exponential backoff: 1s × 2^(n-1), capped at 5 minutes.
 * Matches the behaviour of the old BACKOFF_RECONNECT constant.
 */
export function defaultRetryDelay(_err: unknown, retryCount: number) {
  return timer(Math.min(1000 * Math.pow(2, retryCount - 1), 5 * 60_000));
}

/**
 * Rate-limit backoff: 30s × 2^(n-1), capped at 30 minutes.
 * Used when a relay closes a subscription with a "rate-limited:" prefix.
 */
export function rateLimitedRetryDelay(_err: unknown, retryCount: number) {
  return timer(Math.min(30_000 * Math.pow(2, retryCount - 1), 30 * 60_000));
}

/**
 * NIP-01 CLOSED prefixes that are permanent policy decisions — the relay will
 * not accept this subscription regardless of how many times we retry.
 * Fast-fail these immediately rather than burning retries.
 *
 * Note: these are filtered by subscription ID inside applesauce's req(), so
 * they are specific to our REQ — not bleed-through from concurrent publishes.
 *
 * "duplicate" is intentionally excluded: it means our REQ ID collided with an
 * existing subscription, which defer()+retry() resolves automatically because
 * req() generates a fresh nanoid() on each re-execution.
 */
const PERMANENT_CLOSED_PREFIXES = new Set([
  "restricted", // paid relay, invite-only, etc. — will never let us read
  "blocked", // our pubkey or IP is blocked from reading
  "pow", // proof-of-work required on REQ (we don't support PoW)
  "mute", // relay policy mute on the queried content
  "unsupported", // filter uses a feature the relay doesn't support (e.g. search)
  "invalid", // malformed filter — our bug, retrying the same filter won't help
]);

/**
 * Extract the NIP-01 machine-readable prefix from a RelayClosedError reason,
 * e.g. "rate-limited: too many requests" → "rate-limited".
 */
function closedPrefix(err: RelayClosedError): string {
  return err.reason.split(":")[0].trim();
}

/**
 * Returns true for CLOSED errors that are permanent relay policy decisions
 * and should not be retried.
 */
function isPermanentError(err: unknown): boolean {
  return (
    err instanceof RelayClosedError &&
    !(err instanceof AuthRequiredError) &&
    PERMANENT_CLOSED_PREFIXES.has(closedPrefix(err))
  );
}

/**
 * Returns true for CLOSED errors that indicate rate-limiting and need a
 * prolonged backoff before retrying.
 */
function isRateLimited(err: unknown): boolean {
  return (
    err instanceof RelayClosedError &&
    !(err instanceof AuthRequiredError) &&
    closedPrefix(err) === "rate-limited"
  );
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
      | "reconnect"
      | "gapFill"
      | "gapFillBuffer"
      | "paginate"
      | "limit"
      | "retryCount"
      | "retryDelay"
    >
  > & { manualPaginate$: Observable<void> | undefined },
  signal: SettleSignal,
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
    // Persists across retry/repeat cycles. Once true, any subsequent drop is
    // treated as transient and retried indefinitely (with backoff) rather than
    // consuming the fixed retryCount budget.
    let everReceivedEose = false;
    // Reconnect attempt counter for backoff calculation. Reset to 0 each time
    // EOSE is received so that a relay that has been healthy for a long time
    // starts its next reconnect from 1s rather than the capped maximum.
    let reconnectAttempts = 0;
    let paginateSub: { unsubscribe(): void } | undefined;
    let manualSub: { unsubscribe(): void } | undefined;
    let gapFillSub: { unsubscribe(): void } | undefined;

    // Shared pagination window — driven by auto (BehaviorSubject) or manual.
    let window$: Subject<{ since?: number; until?: number }> | undefined;

    const startPagination = () => {
      // Wrap pool so signal.extend() is called at the start of every internal
      // page request, not just the first — loadBlocksFromRelay drives
      // subsequent pages internally without pushing to window$ again.
      const extendingPool = (relays: string[], filters: Filter[]) => {
        signal.extend(relay);
        return pool.request(relays, filters);
      };

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
          loadBlocksFromRelay(extendingPool, relay, paginationFilters, {
            limit,
          }),
          // Pagination errors are non-fatal — finalize still runs and settles
          // the relay. The merge of all per-relay streams continues.
          catchError(() => EMPTY),
          finalize(() => {
            signal.settle(relay);
          }),
        )
        .subscribe({
          next: (event) => {
            if (oldestSeen === undefined || event.created_at < oldestSeen) {
              oldestSeen = event.created_at;
            }
            subscriber.next(event);
          },
        });
    };

    // Build the live subscription factory. defer() re-executes on each retry
    // (error) and repeat (graceful close) so lastReceivedAt is read fresh on
    // every reconnect attempt, injecting since: lastReceivedAt - gapFillBuffer
    // to avoid replaying the full relay history.
    //
    // We pass reconnect: false to disable applesauce's internal repeat() logic.
    // applesauce's "reconnect" option maps to a repeat() operator that
    // resubscribes after a graceful relay CLOSED (up to 3× with linear backoff
    // by default). We disable it here because:
    //   1. We own the reconnect lifecycle via our own retry() + repeat() below.
    //   2. Internal resubscriptions would bypass our lastReceivedAt tracking,
    //      causing the reconnect REQ to replay the full relay history instead
    //      of using since: lastReceivedAt - gapFillBuffer.
    //   3. Internal resubscriptions would not update the settle signal, so EOSE
    //      could fire before the relay has finished resending missed events.
    const buildLiveSub = () => {
      // Reset per-subscription-cycle state so that countBeforeEose and
      // oldestSeen are tracked correctly after a retry or graceful-close repeat.
      // lastReceivedAt is intentionally NOT reset — it persists across cycles
      // so the reconnect REQ uses since: lastReceivedAt - gapFillBuffer.
      eoseSeen = false;
      countBeforeEose = 0;
      const filtersWithSince: Filter[] = liveFilters.map((f) => ({
        ...f,
        ...(opts.reconnect && lastReceivedAt !== undefined
          ? { since: lastReceivedAt - opts.gapFillBuffer }
          : {}),
      }));
      // Use the single-relay API so the stream still emits NostrEvent | "EOSE"
      // — the group-level pool.subscription() strips EOSE in v6, but we need it
      // here to drive the settle signal.
      return pool.relay(relay).subscription(filtersWithSince, {
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
        retry({
          // count is managed manually inside delay so we can apply different
          // limits before vs after first EOSE. Set to Infinity here and throw
          // from delay when we want to give up.
          count: Infinity,
          delay: (err) => {
            // Auth-required: fast-fail — handled asynchronously by the
            // pool-level auth policy in nostr.ts.
            if (err instanceof AuthRequiredError) throw err;
            // Permanent policy errors: the relay will never accept this
            // subscription regardless of retries. Fast-fail immediately.
            if (isPermanentError(err)) throw err;
            // Rate-limited: relay is overloaded. Use a prolonged backoff
            // (30s base) to avoid hammering it further.
            reconnectAttempts++;
            if (!everReceivedEose && reconnectAttempts > opts.retryCount)
              throw err;
            if (isRateLimited(err))
              return rateLimitedRetryDelay(err, reconnectAttempts);
            return typeof opts.retryDelay === "function"
              ? opts.retryDelay(err, reconnectAttempts)
              : timer(opts.retryDelay ?? 0);
          },
        }),
        // Graceful relay close (CLOSED without an error prefix) completes the
        // stream rather than erroring it, so retry() above won't catch it.
        // repeat() resubscribes after a graceful close, re-executing defer() so
        // lastReceivedAt is read fresh and the reconnect REQ uses
        // since: lastReceivedAt - gapFillBuffer.
        // Same logic: unlimited repeats after first EOSE, capped before it.
        // Throwing from the delay function propagates to catchError below which
        // calls signal.error(relay) and completes the stream silently.
        repeat({
          count: Infinity,
          delay: () => {
            reconnectAttempts++;
            if (!everReceivedEose && reconnectAttempts > opts.retryCount)
              throw new Error(
                `relay ${relay} gave up after ${reconnectAttempts} graceful closes`,
              );
            return typeof opts.retryDelay === "function"
              ? opts.retryDelay(undefined, reconnectAttempts)
              : timer(opts.retryDelay ?? 0);
          },
        }),
        // Graceful relay close (CLOSED without an error prefix) completes the
        // stream rather than erroring it, so retry() above won't catch it.
        // repeat() resubscribes after a graceful close, re-executing defer() so
        // lastReceivedAt is read fresh and the reconnect REQ uses
        // since: lastReceivedAt - gapFillBuffer.
        // Same logic: unlimited repeats after first EOSE, capped before it.
        // Throwing from the delay function propagates to catchError below which
        // calls signal.error(relay) and completes the stream silently.
        repeat({
          count: Infinity,
          delay: (repeatCount) => {
            if (!everReceivedEose && repeatCount > opts.retryCount)
              throw new Error(
                `relay ${relay} gave up after ${repeatCount} graceful closes`,
              );
            return typeof opts.retryDelay === "function"
              ? opts.retryDelay(undefined, repeatCount)
              : timer(opts.retryDelay ?? 0);
          },
        }),
        // After retries are exhausted (or a fast-fail error surfaces),
        // notify the settle signal so consumers don't wait forever, then
        // complete this per-relay stream silently. The outer merge() of all
        // per-relay streams continues — other relays carry on producing events.
        // MUST be after retry() so transient errors get retried first.
        catchError((err) => {
          if (err instanceof AuthRequiredError) {
            // Relay requires NIP-42 auth. The pool-level policy in nostr.ts
            // will authenticate if this is a trusted relay and retry the
            // subscription naturally on reconnect. Settle immediately so the
            // EOSE signal isn't held up waiting for a relay we can't read.
            console.debug(
              `[resilientSubscription] auth-required on ${relay} — settling`,
            );
          } else if (isPermanentError(err)) {
            // Permanent relay policy — no point retrying.
            console.debug(
              `[resilientSubscription] permanent error on ${relay} (${closedPrefix(err as RelayClosedError)}) — settling`,
            );
          }
          signal.error(relay);
          return EMPTY;
        }),
      )
      .subscribe({
        next: (msg) => {
          if (msg === "EOSE") {
            eoseSeen = true;
            everReceivedEose = true;
            reconnectAttempts = 0;
            if (opts.paginate || opts.manualPaginate$) {
              if (opts.manualPaginate$) {
                // Manual mode: signal settled at EOSE; start pagination if needed
                signal.settle(relay);
                if (countBeforeEose >= limit) startPagination();
              } else {
                // Auto mode: paginate if relay was truncated
                if (countBeforeEose < limit) {
                  signal.settle(relay);
                } else {
                  startPagination();
                }
              }
            } else {
              signal.settle(relay);
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
        complete: () => {
          subscriber.complete();
        },
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
  const retryCount = opts.retryCount ?? 3;
  const retryDelay = opts.retryDelay ?? defaultRetryDelay;
  const manualPaginate$ = opts.manualPaginate$;

  if (relays.length === 0) return EMPTY;

  const resolvedOpts = {
    reconnect,
    gapFill,
    gapFillBuffer,
    paginate,
    limit,
    retryCount,
    retryDelay,
    manualPaginate$,
  };

  if (!settle) {
    // No settle signal — just merge per-relay streams
    const dummySignal: SettleSignal = {
      extend: () => {},
      settle: () => {},
      error: () => {},
      eose$: EMPTY as Observable<"EOSE">,
    };
    const perRelayStreams = relays.map((relay) =>
      processRelay(pool, relay, filters, resolvedOpts, dummySignal),
    );
    return merge(...perRelayStreams);
  }

  // With settle signal: share a single signal across all relays
  const settleOpts: SettleSignalOptions = {
    settleTime,
    relayIds: relays,
  };
  const signal = makeSettleSignal(settleOpts);

  const perRelayStreams = relays.map((relay) =>
    processRelay(pool, relay, filters, resolvedOpts, signal),
  );

  return merge(merge(...perRelayStreams), signal.eose$);
}
