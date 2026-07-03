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
import { loadBackwardBlocks } from "applesauce-loaders/loaders";
import type { TimelessFilter } from "applesauce-loaders";
import type { NostrEvent } from "nostr-tools";
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  Subscription,
  bufferTime,
  defer,
  filter,
  finalize,
  identity,
  merge,
  repeat,
  retry,
  share,
  switchMap,
  take,
  tap,
  timer,
  catchError,
} from "rxjs";
import { makeSettleSignal, DEFAULT_SETTLE_TIME } from "./settleSignal";
import type { SettleSignal, SettleSignalOptions } from "./settleSignal";
import { foregroundResume$ } from "./foregroundResume";

/**
 * Thrown when the shared WebSocket to a relay is in a failed state — either
 * already failed at the moment we subscribe (relay.error$ non-null), or
 * transitions to failed while we are subscribed.
 *
 * The Relay class swallows WebSocket errors in its watchTower (catchError →
 * NEVER) and never surfaces them to our retry() handler. On an unclean close
 * it sets ready$=false and waits in waitForReady() — so a naive subscription
 * just hangs silently rather than erroring. We watch relay.error$ (a
 * BehaviorSubject set to non-null by startReconnectTimer on any unclean
 * close, cleared on successful open$) and surface this error ourselves to
 * let retry() take over.
 *
 * Cadence: socket-level reconnects are governed entirely by
 * relay.reconnectTimer (configured in nostr.ts as a 3-phase curve). Our
 * retry handler subscribes to the watchTower (keeping it alive so the
 * reconnect timer can drive new connection attempts) and waits for open$
 * to confirm a successful connection before re-executing buildLiveSub.
 */
export class TransportError extends Error {
  constructor(relay: string) {
    super(`transport failure on ${relay}`);
    this.name = "TransportError";
  }
}

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
    number | ((error: unknown, retryCount: number) => ReturnType<typeof timer>);
  /**
   * Called when a relay settles (EOSE received, or rate-limit cooldown active
   * on first connect, or no pagination needed). Useful when the caller manages
   * its own settle signal and passes settle: false.
   */
  onRelaySettle?: (relay: string) => void;
  /**
   * Called when a relay fails permanently (auth-required or permanent CLOSED).
   * Useful when the caller manages its own settle signal and passes
   * settle: false.
   */
  onRelayError?: (relay: string) => void;
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
  > & {
    manualPaginate$: Observable<void> | undefined;
    onRelaySettle: ((relay: string) => void) | undefined;
    onRelayError: ((relay: string) => void) | undefined;
  },
  signal: SettleSignal,
): Observable<NostrEvent> {
  const limit = opts.limit;

  // Live filters: keep limit so the relay returns at most `limit` historical
  // events before EOSE. New events published after the subscription opens are
  // always forwarded regardless of limit — it only caps the backfill.
  // On reconnect, since: lastReceivedAt is injected (see buildLiveSub) which
  // already scopes the backfill to the gap window, so limit is less relevant
  // there but harmless to keep.
  const liveFilters: Filter[] = filters.map((f) => ({ ...f }));

  // Pagination filters: strip since/until/limit (TimelessFilter).
  // NOTE: mergeFilters (used by loadBlocksFromRelay) only handles kinds, ids,
  // authors, tag filters, limit, since, and until — it silently drops scalar
  // fields like `search`. We preserve those extras here and re-apply them in
  // extendingPool after the merge so they survive into every page REQ.
  const paginationFilters: TimelessFilter[] = filters.map((f) => {
    const pf: TimelessFilter = { ...f };
    delete (pf as Filter).since;
    delete (pf as Filter).until;
    delete (pf as Filter).limit;
    return pf;
  });

  // Scalar fields that mergeFilters drops — keyed by filter index so we can
  // restore them per-filter after the merge.
  const scalarExtras: Array<Partial<Filter>> = filters.map((f) => {
    const extras: Partial<Filter> = {};
    for (const key of Object.keys(f) as Array<keyof Filter>) {
      if (
        key === "kinds" ||
        key === "ids" ||
        key === "authors" ||
        key === "since" ||
        key === "until" ||
        key === "limit" ||
        key[0] === "#" ||
        key[0] === "&"
      )
        continue;
      // @ts-expect-error — copy any remaining scalar field (e.g. search)
      extras[key] = f[key];
    }
    return extras;
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
      // loadBackwardBlocks is used here as a backward-only pagination cursor
      // state machine: it tracks the backward cursor, prevents parallel page
      // loads, and detects exhaustion (zero events returned). Using
      // loadBackwardBlocks (rather than loadBlocksFromRelay / loadBlocksForTimelineWindow)
      // avoids the bug where loadForwardBlocks also fires on the first window
      // emission (when its cursor is undefined), sending a spurious REQ without
      // an `until` filter that re-fetches the most-recent events.
      //
      // signal.extend() is called on every page request to keep the settle
      // signal alive while pagination is in flight.
      const backwardRequest = (until: number | undefined) => {
        signal.extend(relay);
        // Build filters: start from paginationFilters (already stripped of
        // since/until/limit), restore scalar extras (e.g. search) that
        // mergeFilters would drop, then apply limit and until.
        const restoredFilters: Filter[] = paginationFilters.map((f, i) => ({
          ...(scalarExtras[i] ?? {}),
          ...f,
          limit,
          ...(until !== undefined ? { until } : {}),
        }));
        return resilientSingleRelayRequest(pool, relay, restoredFilters, {
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
          loadBackwardBlocks(backwardRequest, { limit }),
          // Pagination errors are non-fatal — finalize still runs and settles
          // the relay. The merge of all per-relay streams continues.
          catchError(() => EMPTY),
          finalize(() => {
            signal.settle(relay);
            opts.onRelaySettle?.(relay);
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
    // Note on applesauce's `reconnect` / `resubscribe` options: in
    // applesauce-relay@6.0.0 the `reconnect` option on subscription() /
    // request() is plumbed through but never read by req() — only publish()
    // consumes it (see relay.js:758). The `resubscribe` option (which maps
    // to a repeat() operator) IS read but defaults to undefined → identity,
    // i.e. no internal repeat. So we don't need to pass either; applesauce
    // does no internal REQ-level retry/repeat for subscriptions. The only
    // applesauce retry layer is the auth-only retry inside req() (line 546)
    // which only handles AuthRequiredError.
    //
    // Socket-level reconnect cadence is governed entirely by
    // relay.reconnectTimer (replaced with a 3-phase curve in nostr.ts).
    // Our retry handler subscribes to the watchTower (keeping it alive so
    // the reconnect timer can drive new connection attempts) and waits for
    // open$ to confirm a successful connection before re-executing buildLiveSub.
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
      // CRITICAL: The Relay class swallows WebSocket errors in its watchTower
      // (catchError → NEVER) and never surfaces them to our retry() handler.
      // Instead, on an unclean close the relay sets ready$=false and waits in
      // waitForReady() — so our subscription just hangs silently rather than
      // erroring.
      //
      // close$ is a plain Subject (no replay) — we'd miss events fired before
      // we subscribed. connected$ starts false before any connection attempt,
      // so we can't distinguish "never connected" from "currently failed".
      //
      // error$ is a BehaviorSubject<Error|null> set to non-null exactly when
      // startReconnectTimer fires (unclean close / watchTower error), and
      // reset to null on successful open. This means a single subscription
      // catches both:
      //   - already non-null when we subscribe → relay is currently failed
      //     (fast-fail for late-comers — settle signal sees error
      //     immediately, doesn't wait for the underlying retry cycle)
      //   - transitions to non-null while we are subscribed → relay just failed
      //
      // We can't merge() error$ into the subscription stream — error$ never
      // completes naturally, so merge would hang on a graceful CLOSED instead
      // of letting repeat() resubscribe. Instead use an imperative Observable
      // that forwards subscription notifications and listens to error$ for
      // the lifetime of the inner subscription only.
      const relayObj = pool.relay(relay);
      const inner$ = relayObj.subscription(filtersWithSince);
      const sub$ = new Observable<NostrEvent | "EOSE">((s) => {
        const errSub = relayObj.error$.subscribe((err) => {
          if (err !== null) s.error(new TransportError(relay));
        });
        const innerSub = inner$.subscribe({
          next: (v) => s.next(v),
          error: (e) => s.error(e),
          complete: () => s.complete(),
        });
        return () => {
          errSub.unsubscribe();
          innerSub.unsubscribe();
        };
      });

      // If this relay is currently rate-limited, wait out the cooldown before
      // opening the subscription. This prevents other concurrent subscriptions
      // from hammering the relay while it is cooling down, which would reset
      // the relay's rate-limit window and delay recovery further.
      //
      // Settle the relay immediately when a cooldown is active so the EOSE
      // signal is not blocked waiting for a relay we know won't respond yet.
      // The subscription will still open after the cooldown and deliver live
      // events — it just won't contribute to the initial EOSE settle window.
      const remaining = getRateLimitCooldownRemaining(relay);
      if (remaining > 0) {
        signal.settle(relay);
        opts.onRelaySettle?.(relay);
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
            // Rate-limited: relay is overloaded. Record the cooldown so all
            // other concurrent subscriptions to this relay also hold off,
            // preventing a stampede that would reset the relay's window.
            if (isRateLimited(err)) {
              reconnectAttempts++;
              if (!everReceivedEose && reconnectAttempts > opts.retryCount)
                throw err;
              const { ms, timer$ } = rateLimitedRetryDelay(
                err,
                reconnectAttempts,
              );
              markRateLimited(relay, Date.now() + ms);
              return timer$;
            }
            // Transport-level error: the shared WebSocket is failing. Cadence
            // is owned entirely by relay.reconnectTimer (3-phase curve in
            // nostr.ts).
            //
            // The naive approach of waiting on relay.open$ breaks because:
            // while waiting, nothing is subscribed to the watchTower. After
            // the watchTower's 30s keepAlive window, its source is fully
            // unsubscribed. When the reconnect timer fires and sets ready$=true,
            // the watchTower is already gone — no new WebSocket attempt is made
            // and open$ never fires.
            //
            // The naive approach of waiting on relay.ready$ breaks because:
            // error$ is only cleared on open$ (successful connection). When
            // ready$ becomes true and defer() re-executes buildLiveSub, error$
            // is still non-null → immediate TransportError → infinite loop.
            //
            // Correct fix: subscribe to the watchTower during the delay to
            // keep it alive (so the reconnect timer can drive new connection
            // attempts), AND wait for open$ to confirm the connection succeeded
            // before re-executing buildLiveSub. open$ fires synchronously from
            // the watchTower's openObserver, so it will emit while we are
            // subscribed to the watchTower here.
            //
            // Settle the signal as errored on each transport failure — the
            // settle signal is one-shot per relay so the first call wins,
            // but firing on every transport flap is correct because
            // late-comers that subscribe while the socket is currently down
            // need to fast-settle their settle signal immediately rather
            // than wait for the underlying retry cycle to complete.
            //
            // No retryCount budget here — while the socket is bouncing we
            // patiently wait. If the relay never recovers, open$ never fires
            // and the subscription quietly remains dormant; if a caller
            // unsubscribes, the watchTower sub and take(1) are torn down
            // with no leak.
            if (err instanceof TransportError) {
              signal.error(relay);
              opts.onRelayError?.(relay);
              const relayObj = pool.relay(relay);
              // watchTower is protected in TypeScript but is a plain property
              // at runtime — cast to access it. Subscribing to it increments
              // the share() refcount, keeping the WebSocket alive so the
              // reconnect timer can drive new connection attempts.
              const wt = (
                relayObj as unknown as { watchTower: Observable<never> }
              ).watchTower;
              return new Observable<never>((s) => {
                // Keep the watchTower alive so the reconnect timer can drive
                // new connection attempts. The watchTower is share()d so this
                // just increments the refcount — no duplicate socket is opened.
                const watchSub = wt.subscribe();
                // Wait for the next successful open before completing so
                // defer() re-executes buildLiveSub with a clean error$ state.
                const openSub = relayObj.open$.pipe(take(1)).subscribe({
                  next: () => s.complete(),
                  error: (e) => s.error(e),
                });
                return () => {
                  watchSub.unsubscribe();
                  openSub.unsubscribe();
                };
              });
            }
            // NIP-01 CLOSED (non-rate-limited, non-permanent): use our own
            // backoff. The WebSocket is still open so waitForReady won't block.
            reconnectAttempts++;
            if (!everReceivedEose && reconnectAttempts > opts.retryCount)
              throw err;
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
          opts.onRelayError?.(relay);
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
                // Manual mode: always start pagination so the Subject has a
                // subscriber. The caller decides when to fire the next page;
                // loadBlocksFromRelay will naturally exhaust when the relay
                // returns zero events.
                signal.settle(relay);
                opts.onRelaySettle?.(relay);
                startPagination();
              } else {
                // Auto mode: paginate if relay was truncated
                if (countBeforeEose < limit) {
                  signal.settle(relay);
                  opts.onRelaySettle?.(relay);
                  // autoClose: no pagination needed — complete the per-relay stream
                  if (opts.autoClose) subscriber.complete();
                } else {
                  startPagination();
                }
              }
            } else {
              signal.settle(relay);
              opts.onRelaySettle?.(relay);
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
            opts.onRelaySettle?.(relay);
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
  const onRelaySettle = opts.onRelaySettle;
  const onRelayError = opts.onRelayError;

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
    onRelaySettle,
    onRelayError,
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
  const onRelaySettle = opts.onRelaySettle;
  const onRelayError = opts.onRelayError;

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
    onRelaySettle,
    onRelayError,
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
    // Race the request against relay.error$ so that a transport failure
    // (ERR_ADDRESS_UNREACHABLE, 404, etc.) surfaces as a TransportError
    // rather than hanging silently in Relay.waitForReady(). error$ is a
    // BehaviorSubject set to non-null by startReconnectTimer on any unclean
    // close — catches both "already failed" and "fails while subscribed".
    //
    // Use an imperative Observable rather than merge(error$) so the watcher
    // is torn down when the request completes naturally — merge would hang
    // because error$ never completes on its own.
    const relayObj = pool.relay(relay);
    const inner$ = relayObj.request(filters);
    const req$ = new Observable<NostrEvent>((s) => {
      const errSub = relayObj.error$.subscribe((err) => {
        if (err !== null) s.error(new TransportError(relay));
      });
      const innerSub = inner$.subscribe({
        next: (v) => s.next(v),
        error: (e) => s.error(e),
        complete: () => s.complete(),
      });
      return () => {
        errSub.unsubscribe();
        innerSub.unsubscribe();
      };
    });
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
        if (isRateLimited(err)) {
          reconnectAttempts++;
          if (!everSucceeded && reconnectAttempts > retryCount) throw err;
          const { ms, timer$ } = rateLimitedRetryDelay(err, reconnectAttempts);
          markRateLimited(relay, Date.now() + ms);
          return timer$;
        }
        // Transport error: same fix as processRelay — subscribe to the
        // watchTower to keep it alive (so the reconnect timer drives new
        // connection attempts) and wait for open$ to confirm success before
        // defer() re-executes. See processRelay for the full explanation.
        if (err instanceof TransportError) {
          const relayObj = pool.relay(relay);
          const wt = (relayObj as unknown as { watchTower: Observable<never> })
            .watchTower;
          return new Observable<never>((s) => {
            const watchSub = wt.subscribe();
            const openSub = relayObj.open$.pipe(take(1)).subscribe({
              next: () => s.complete(),
              error: (e) => s.error(e),
            });
            return () => {
              watchSub.unsubscribe();
              openSub.unsubscribe();
            };
          });
        }
        // CLOSED (non-rate-limited, non-permanent): own backoff; WS is open.
        reconnectAttempts++;
        if (!everSucceeded && reconnectAttempts > retryCount) throw err;
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

// ---------------------------------------------------------------------------
// createBatchedEventFetcher
// ---------------------------------------------------------------------------

/**
 * Options for createBatchedEventFetcher.
 */
export interface BatchedEventFetcherOptions {
  /**
   * Time window in ms to buffer incoming requests before firing a batch REQ.
   * Default: 500
   */
  bufferTime?: number;
  /**
   * Maximum number of IDs per batch window.
   * Default: 200
   */
  bufferSize?: number;
  /**
   * Extra relay URLs always included in every batch REQ (e.g. fallback relays).
   * These are unioned with the per-call relay hints.
   */
  extraRelays?: string[];
  /**
   * When false (default) each batch uses resilientRequest — the per-relay
   * stream completes after EOSE. Callers that don't find their event within
   * the batch receive an empty observable (treat as "not found").
   *
   * When true each batch uses resilientSubscription — the per-relay stream
   * stays open indefinitely. Callers remain subscribed until they find their
   * event or unsubscribe. Useful for watching for an event that may not exist
   * yet (e.g. waiting for a reply to arrive).
   */
  live?: boolean;
  /**
   * ResilientSubscription options forwarded to the underlying
   * resilientRequest / resilientSubscription call for each relay stream.
   * autoClose is set automatically based on the `live` flag and must not be
   * passed here.
   */
  relayOpts?: Omit<ResilientSubscriptionOptions, "autoClose">;
}

/** A pointer passed to the batched fetcher. */
interface EventPointer {
  id: string;
  /** Relay hints for this specific event. Unioned with extraRelays. */
  relays: string[];
}

/**
 * A batched event fetcher.
 *
 * Call it with an event ID and relay hints; it returns an Observable<NostrEvent>
 * that emits the event when found.
 *
 * - In request mode (live: false, default): completes after the batch EOSE.
 *   If the event is not found the observable completes empty — wrap in
 *   firstValueFrom() with a timeout to get Promise<NostrEvent | undefined>.
 * - In subscription mode (live: true): stays open until the caller unsubscribes.
 */
export type BatchedEventFetcher = (
  id: string,
  relays: string[],
) => Observable<NostrEvent>;

/**
 * Build a per-relay filter map from a batch of pointers.
 * Returns Map<relayUrl, string[]> — the set of IDs to request from each relay.
 */
function buildBatchRelayMap(
  pointers: EventPointer[],
  extraRelays: string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  const addId = (relay: string, id: string) => {
    let ids = map.get(relay);
    if (!ids) {
      ids = [];
      map.set(relay, ids);
    }
    if (!ids.includes(id)) ids.push(id);
  };

  for (const { id, relays } of pointers) {
    const allRelays = new Set([...relays, ...extraRelays]);
    for (const relay of allRelays) addId(relay, id);
  }

  return map;
}

/**
 * Creates a batched event fetcher that coalesces individual event-by-ID
 * requests into a single `{ ids: [...] }` REQ per relay per buffer window.
 *
 * All the benefits of resilientRequest / resilientSubscription are preserved
 * (rate-limit backoff, reconnect, permanent error fast-fail, transport error
 * handling) because each per-relay stream is a full resilientRequest /
 * resilientSubscription pipeline.
 *
 * Create one instance per pool at module/app level and reuse it — the
 * internal queue and buffer state are shared across all callers, which is
 * what enables the batching.
 *
 * @example
 * // Module level
 * const fetchEvent = createBatchedEventFetcher(pool, { extraRelays: fallbackRelays });
 *
 * // Per call — request mode (default)
 * const event = await firstValueFrom(
 *   fetchEvent(id, relayHints).pipe(timeout(5000))
 * ).catch(() => undefined);
 *
 * // Per call — subscription mode
 * const fetcher = createBatchedEventFetcher(pool, { live: true });
 * fetcher(id, relays).subscribe(event => console.log('arrived:', event));
 */
export function createBatchedEventFetcher(
  pool: RelayPool,
  opts: BatchedEventFetcherOptions = {},
): BatchedEventFetcher {
  const bufferMs = opts.bufferTime ?? 500;
  const bufferMax = opts.bufferSize ?? 200;
  const extraRelays = opts.extraRelays ?? [];
  const live = opts.live ?? false;
  const relayOpts = opts.relayOpts ?? {};

  // Incoming pointer queue — one entry per call to the returned fetcher.
  const queue = new Subject<EventPointer>();

  // Emits one shared observable per batch window. Each emission is the merged
  // stream of all per-relay resilientRequest / resilientSubscription pipelines
  // for that batch, shared so all callers in the window subscribe to the same
  // underlying REQs.
  const next = new Subject<Observable<NostrEvent>>();

  // Process each buffer window.
  queue.pipe(bufferTime(bufferMs, undefined, bufferMax)).subscribe((batch) => {
    if (batch.length === 0) return;

    const relayMap = buildBatchRelayMap(batch, extraRelays);

    // One resilientRequest / resilientSubscription per relay, merged together.
    const perRelayStreams = Array.from(relayMap.entries()).map(
      ([relay, ids]) => {
        const filters: Filter[] = [{ ids } as Filter];
        return resilientSubscription(pool, [relay], filters, {
          ...relayOpts,
          autoClose: !live,
        }).pipe(onlyEvents()) as Observable<NostrEvent>;
      },
    );

    if (perRelayStreams.length === 0) return;

    const batch$: Observable<NostrEvent> = merge(...perRelayStreams).pipe(
      // Keep the shared stream alive as long as at least one caller is
      // subscribed. resetOnRefCountZero: false means late subscribers (those
      // that subscribe after the first event has already arrived) still see
      // future events from the same batch rather than triggering a new one.
      share({ resetOnRefCountZero: false, resetOnComplete: false }),
    );

    next.next(batch$);
  });

  return (id: string, relays: string[]): Observable<NostrEvent> =>
    new Observable<NostrEvent>((observer) => {
      // Enqueue before subscribing to next$ so the pointer is in the buffer
      // before the next tick's bufferTime flush. (Same reasoning as batchLoader
      // in applesauce — bufferTime uses setTimeout internally so the queue.next
      // always lands before the flush even though it's synchronous here.)
      queue.next({ id, relays });

      const filtered$: Observable<NostrEvent> = next.pipe(
        // Latch onto the very next batch emission — that's the one our
        // pointer was included in.
        take(1),
        // Subscribe to the shared batch stream and filter for our ID.
        switchMap((batch$: Observable<NostrEvent>) =>
          batch$.pipe(filter((event: NostrEvent) => event.id === id)),
        ),
      );

      // In request mode, complete as soon as we find the event so the
      // caller's firstValueFrom() resolves immediately rather than waiting
      // for the full batch EOSE.
      const out$ = live ? filtered$ : filtered$.pipe(take(1));

      const sub = out$.subscribe(observer);

      return () => sub.unsubscribe();
    });
}
