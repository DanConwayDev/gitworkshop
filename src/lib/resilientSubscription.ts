/**
 * resilientSubscription / resilientRequest
 *
 * resilientSubscription — a wrapper around pool.subscription() that provides:
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
 * resilientRequest — same as resilientSubscription but with autoClose: true.
 * Each per-relay stream completes once the relay has finished its work (EOSE,
 * plus all pagination pages if paginate is enabled). The merged stream
 * therefore completes naturally when every relay is done. Reconnect and
 * gap-fill are disabled by default (pass reconnect/gapFill: true to override).
 *
 * The function opens a per-relay pipeline for each relay URL (like
 * processRelayStream does), merges them, and shares the settle signal.
 *
 * IMPORTANT: neither function adds mapEventsToStore or filterDuplicateEvents.
 * Callers pipe those themselves. The functions return raw NostrEvent | "EOSE"
 * and callers use onlyEvents() to strip EOSE if not needed.
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
  Subscription,
  defer,
  finalize,
  identity,
  merge,
  repeat,
  retry,
  switchMap,
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
   * Auto-close each per-relay stream once it has finished its work (EOSE,
   * plus all pagination pages when paginate is enabled). When true the merged
   * stream completes naturally once every relay is done — making this behave
   * like a one-shot request rather than a long-lived subscription.
   *
   * When autoClose is true:
   *   - reconnect defaults to false (no point reconnecting after we're done)
   *   - gapFill defaults to false (no foreground resume needed)
   *   - repeat() is skipped (graceful relay close = done, not reconnect)
   *
   * Default: false
   */
  autoClose?: boolean;
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
 * Rate-limit backoff: 60–90s × 2^(n-1), capped at 30 minutes.
 * The jitter (random 0–30s added to the 60s base) prevents a stampeding
 * herd when multiple subscriptions to the same relay all back off and
 * retry at the same moment.
 *
 * Returns both the delay in ms and the RxJS timer so callers can record
 * the cooldown end time without recomputing the jitter independently.
 */
export function rateLimitedRetryDelay(
  _err: unknown,
  retryCount: number,
): { ms: number; timer$: ReturnType<typeof timer> } {
  const jitter = Math.random() * 30_000;
  const ms = Math.min(
    (60_000 + jitter) * Math.pow(2, retryCount - 1),
    30 * 60_000,
  );
  return { ms, timer$: timer(ms) };
}

/**
 * Shared per-relay rate-limit cooldown registry.
 *
 * Maps relay URL → timestamp (ms) until which new subscriptions should not
 * be opened. Set when a rate-limited CLOSED is received; checked at the start
 * of every buildLiveSub execution (i.e. on every retry/repeat cycle for every
 * concurrent subscription to that relay). This prevents other subscriptions
 * from immediately hammering a relay that just told us to back off, which
 * would reset the relay's rate-limit window and push out the time we are
 * allowed to reconnect.
 */
const relayRateLimitCooldown = new Map<string, number>();

/**
 * Mark a relay as rate-limited until `until` (epoch ms).
 * Only extends the cooldown — never shortens an existing one.
 */
export function markRateLimited(relayUrl: string, until: number): void {
  const existing = relayRateLimitCooldown.get(relayUrl) ?? 0;
  if (until > existing) relayRateLimitCooldown.set(relayUrl, until);
}

/**
 * Returns the remaining rate-limit cooldown in ms for a relay, or 0 if none.
 */
export function getRateLimitCooldownRemaining(relayUrl: string): number {
  return Math.max(0, (relayRateLimitCooldown.get(relayUrl) ?? 0) - Date.now());
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
export const PERMANENT_CLOSED_PREFIXES = new Set([
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
export function closedPrefix(err: RelayClosedError): string {
  return err.reason.split(":")[0].trim();
}

/**
 * Returns true for CLOSED errors that are permanent relay policy decisions
 * and should not be retried.
 */
export function isPermanentError(err: unknown): boolean {
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
export function isRateLimited(err: unknown): boolean {
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
      | "autoClose"
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
          retryCount: opts.retryCount,
          retryDelay: opts.retryDelay,
        });
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
            // autoClose: pagination is the last work for this relay — complete
            // the per-relay stream so the merged stream can finish naturally.
            if (opts.autoClose) subscriber.complete();
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
      //
      // If this relay is currently rate-limited, wait out the cooldown before
      // opening the subscription. This prevents other concurrent subscriptions
      // from hammering the relay while it is cooling down, which would reset
      // the relay's rate-limit window and delay recovery further.
      //
      // Settle the relay immediately when a cooldown is active so the EOSE
      // signal is not blocked waiting for a relay we know won't respond yet.
      // The subscription will still open after the cooldown and deliver live
      // events — it just won't contribute to the initial EOSE settle window.
      const sub$ = pool.relay(relay).subscription(filtersWithSince, {
        reconnect: false,
      });
      const remaining = getRateLimitCooldownRemaining(relay);
      if (remaining > 0) {
        signal.settle(relay);
        return timer(remaining).pipe(switchMap(() => sub$));
      }
      relayRateLimitCooldown.delete(relay);
      return sub$;
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
            reconnectAttempts++;
            if (!everReceivedEose && reconnectAttempts > opts.retryCount)
              throw err;
            // Rate-limited: relay is overloaded. Record the cooldown so all
            // other concurrent subscriptions to this relay also hold off,
            // preventing a stampede that would reset the relay's window.
            if (isRateLimited(err)) {
              const { ms, timer$ } = rateLimitedRetryDelay(
                err,
                reconnectAttempts,
              );
              markRateLimited(relay, Date.now() + ms);
              return timer$;
            }
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
        //
        // autoClose: skip repeat() entirely — a graceful relay close means the
        // relay is done. The complete handler in the subscriber below settles
        // the signal and completes the per-relay stream.
        opts.autoClose
          ? identity
          : repeat({
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
                if (countBeforeEose >= limit) {
                  startPagination();
                } else if (opts.autoClose) {
                  // No pagination needed — we're done with this relay
                  subscriber.complete();
                }
              } else {
                // Auto mode: paginate if relay was truncated
                if (countBeforeEose < limit) {
                  signal.settle(relay);
                  // autoClose: no pagination needed — complete the per-relay stream
                  if (opts.autoClose) subscriber.complete();
                } else {
                  startPagination();
                }
              }
            } else {
              signal.settle(relay);
              // autoClose: no pagination — complete the per-relay stream so the
              // merged stream finishes naturally once all relays are done.
              if (opts.autoClose) subscriber.complete();
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
          // autoClose: a graceful relay close (CLOSED without error prefix)
          // means the relay is done — treat it as settled rather than
          // reconnecting. Without autoClose the repeat() operator above would
          // resubscribe; with autoClose repeat() is skipped so this fires.
          if (opts.autoClose) {
            signal.settle(relay);
          }
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
 *
 * Overloads:
 *   - Static relay list: resilientSubscription(pool, string[], filters, opts)
 *   - Reactive relay list: resilientSubscription(pool, Observable<string[]>, filters, opts)
 *     When an Observable is provided the relay set is diffed on each emission.
 *     New relays are added without disturbing existing streams; removed relays
 *     are unsubscribed and removed from the settle signal.
 */
export function resilientSubscription(
  pool: RelayPool,
  relays: string[],
  filters: Filter[],
  opts?: ResilientSubscriptionOptions,
): Observable<ResilientSubscriptionResponse>;
export function resilientSubscription(
  pool: RelayPool,
  relays: Observable<string[]>,
  filters: Filter[],
  opts?: ResilientSubscriptionOptions,
): Observable<ResilientSubscriptionResponse>;
export function resilientSubscription(
  pool: RelayPool,
  relays: string[] | Observable<string[]>,
  filters: Filter[],
  opts: ResilientSubscriptionOptions = {},
): Observable<ResilientSubscriptionResponse> {
  if (relays instanceof Observable) {
    return resilientSubscriptionReactive(pool, relays, filters, opts);
  }
  return resilientSubscriptionStatic(pool, relays, filters, opts);
}

/**
 * Static (non-reactive) implementation — relay list is fixed at call time.
 */
function resilientSubscriptionStatic(
  pool: RelayPool,
  relays: string[],
  filters: Filter[],
  opts: ResilientSubscriptionOptions = {},
): Observable<ResilientSubscriptionResponse> {
  const autoClose = opts.autoClose ?? false;
  // autoClose implies one-shot semantics: reconnect and gap-fill are
  // meaningless once the relay has finished its work.
  const reconnect = opts.reconnect ?? (autoClose ? false : true);
  const gapFill = opts.gapFill ?? (autoClose ? false : true);
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
    autoClose,
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
      addRelay: () => {},
      removeRelay: () => {},
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

/**
 * Reactive implementation — relay list is an Observable<string[]>.
 *
 * On each emission the relay set is diffed against the previous emission:
 *   - New relays: a new processRelay() stream is started and merged into the
 *     output. signal.addRelay() is called so allSettled$ waits for the new relay.
 *   - Removed relays: the per-relay stream is unsubscribed and
 *     signal.removeRelay() is called so allSettled$ no longer waits for it.
 *   - Unchanged relays: their streams continue unaffected.
 *
 * The settle signal is created once with no initial relayIds (dynamic mode).
 * Rule 1 (immediate all-done) is driven entirely by addRelay/removeRelay calls.
 * Rules 2 (debounce) and 3 (hard cap) apply as normal.
 */
function resilientSubscriptionReactive(
  pool: RelayPool,
  relays$: Observable<string[]>,
  filters: Filter[],
  opts: ResilientSubscriptionOptions = {},
): Observable<ResilientSubscriptionResponse> {
  const autoClose = opts.autoClose ?? false;
  const reconnect = opts.reconnect ?? (autoClose ? false : true);
  const gapFill = opts.gapFill ?? (autoClose ? false : true);
  const gapFillBuffer = opts.gapFillBuffer ?? 600;
  const settle = opts.settle ?? true;
  const settleTime = opts.settleTime ?? DEFAULT_SETTLE_TIME;
  const paginate = opts.paginate ?? false;
  const limit = opts.limit ?? 500;
  const retryCount = opts.retryCount ?? 3;
  const retryDelay = opts.retryDelay ?? defaultRetryDelay;
  const manualPaginate$ = opts.manualPaginate$;

  const resolvedOpts = {
    autoClose,
    reconnect,
    gapFill,
    gapFillBuffer,
    paginate,
    limit,
    retryCount,
    retryDelay,
    manualPaginate$,
  };

  return new Observable<ResilientSubscriptionResponse>((subscriber) => {
    // Create the settle signal without a fixed relay list (dynamic mode).
    // When settle is disabled we use a dummy signal.
    const signal: SettleSignal = settle
      ? makeSettleSignal({ settleTime })
      : {
          extend: () => {},
          settle: () => {},
          error: () => {},
          addRelay: () => {},
          removeRelay: () => {},
          eose$: EMPTY as Observable<"EOSE">,
        };

    // Map of relay URL → active Subscription so we can tear down removed relays.
    const activeRelays = new Map<string, Subscription>();
    let currentRelays = new Set<string>();

    // Subscribe to the relay list observable and diff on each emission.
    const relaySub = relays$.subscribe({
      next: (newRelays) => {
        const newSet = new Set(newRelays);

        // Add new relays
        for (const relay of newSet) {
          if (!currentRelays.has(relay)) {
            signal.addRelay(relay);
            const relaySub = processRelay(
              pool,
              relay,
              filters,
              resolvedOpts,
              signal,
            ).subscribe({
              next: (event) => subscriber.next(event),
              error: (err) => {
                // Per-relay errors are already handled inside processRelay
                // (catchError → signal.error). This path should not be reached
                // in normal operation, but guard defensively.
                console.error(
                  `[resilientSubscription] unexpected error from relay ${relay}:`,
                  err,
                );
              },
              // Per-relay completion (autoClose) is fine — the outer subscriber
              // stays open until the relay$ observable completes.
            });
            activeRelays.set(relay, relaySub);
          }
        }

        // Remove relays that are no longer in the list
        for (const relay of currentRelays) {
          if (!newSet.has(relay)) {
            activeRelays.get(relay)?.unsubscribe();
            activeRelays.delete(relay);
            signal.removeRelay(relay);
          }
        }

        currentRelays = newSet;
      },
      error: (err) => subscriber.error(err),
      complete: () => {
        // The relay list observable completed — we keep the existing relay
        // streams alive (they manage their own lifecycle) but stop watching
        // for new relays. The outer subscriber completes only when all
        // per-relay streams have finished (autoClose) or when unsubscribed.
        if (autoClose && activeRelays.size === 0) {
          subscriber.complete();
        }
      },
    });

    // Merge the EOSE signal into the output stream.
    const eoseSub = settle
      ? signal.eose$.subscribe({
          next: (v) => subscriber.next(v),
          error: (err) => subscriber.error(err),
        })
      : { unsubscribe: () => {} };

    // Teardown: unsubscribe all active relay streams and the relay list watcher.
    return () => {
      relaySub.unsubscribe();
      eoseSub.unsubscribe();
      for (const sub of activeRelays.values()) sub.unsubscribe();
      activeRelays.clear();
    };
  });
}

/**
 * One-shot variant of resilientSubscription.
 *
 * Behaves identically to resilientSubscription but automatically closes each
 * per-relay stream once the relay has finished its work:
 *   - No pagination: closes after EOSE
 *   - With pagination: closes after the last pagination page completes
 *
 * The merged stream therefore completes naturally once every relay is done,
 * making this suitable for fetch-once use cases (e.g. loading a list of
 * events on mount) without needing to manually unsubscribe.
 *
 * Reconnect and gap-fill are disabled by default (pass reconnect/gapFill: true
 * to override — though this is rarely useful for one-shot requests).
 *
 * Returns Observable<NostrEvent | "EOSE">. Pipe through onlyEvents() if the
 * EOSE signal is not needed.
 *
 * Does NOT add mapEventsToStore or filterDuplicateEvents — callers handle that.
 */
export function resilientRequest(
  pool: RelayPool,
  relays: string[],
  filters: Filter[],
  opts: ResilientSubscriptionOptions = {},
): Observable<ResilientSubscriptionResponse> {
  return resilientSubscription(pool, relays, filters, {
    ...opts,
    autoClose: true,
  });
}

/**
 * Resilient one-shot request to a single relay.
 *
 * Uses pool.relay(relay).request() — the proper single-relay one-shot API
 * that completes naturally after EOSE — wrapped with defer() + retry() so
 * each attempt gets a fresh REQ and the full error-classification logic
 * (exponential backoff, rate-limit cooldown, permanent error fast-fail,
 * AuthRequired fast-fail) is applied.
 *
 * This is the right primitive for pagination page requests where:
 *   - The relay is already known (no pool-level fan-out needed)
 *   - The request must complete after EOSE (one page = one REQ)
 *   - Reconnect and gap-fill are not applicable
 *
 * Returns Observable<NostrEvent> (EOSE is consumed internally by
 * pool.relay().request()).
 */
export function resilientSingleRelayRequest(
  pool: RelayPool,
  relay: string,
  filters: Filter[],
  opts: Pick<ResilientSubscriptionOptions, "retryCount" | "retryDelay"> = {},
): Observable<NostrEvent> {
  const retryCount = opts.retryCount ?? 3;
  let reconnectAttempts = 0;
  let everSucceeded = false;

  return defer(() => {
    // If this relay is currently rate-limited, wait out the cooldown before
    // opening the request. This prevents hammering a relay that just told us
    // to back off, which would reset its rate-limit window.
    const remaining = getRateLimitCooldownRemaining(relay);
    const req$ = pool.relay(relay).request(filters);
    if (remaining > 0) return timer(remaining).pipe(switchMap(() => req$));
    return req$;
  }).pipe(
    tap(() => {
      // Any event received means the request is succeeding — reset backoff
      // so the next retry (if any) starts from 1s again.
      everSucceeded = true;
    }),
    retry({
      count: Infinity,
      delay: (err) => {
        if (err instanceof AuthRequiredError) throw err;
        if (isPermanentError(err)) throw err;
        reconnectAttempts++;
        if (!everSucceeded && reconnectAttempts > retryCount) throw err;
        if (isRateLimited(err)) {
          const { ms, timer$ } = rateLimitedRetryDelay(err, reconnectAttempts);
          markRateLimited(relay, Date.now() + ms);
          return timer$;
        }
        const retryDelay = opts.retryDelay ?? defaultRetryDelay;
        return typeof retryDelay === "function"
          ? retryDelay(err, reconnectAttempts)
          : timer(retryDelay);
      },
    }),
    catchError((err) => {
      if (err instanceof AuthRequiredError) {
        console.debug(
          `[resilientSingleRelayRequest] auth-required on ${relay} — giving up`,
        );
      } else if (isPermanentError(err)) {
        console.debug(
          `[resilientSingleRelayRequest] permanent error on ${relay} (${closedPrefix(err as RelayClosedError)}) — giving up`,
        );
      }
      return EMPTY;
    }),
  );
}
