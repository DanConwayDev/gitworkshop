/**
 * Settle signal helpers
 *
 * A "settle signal" tracks when all in-flight relay work has quieted down and
 * emits a single "EOSE" sentinel. Callers interact via three methods:
 *
 *   extend(relayId)  — relay is starting a new page request. Adds the relay
 *                      to the active extensions set (if not already present)
 *                      and resets its per-relay timer to now+settleTime. The
 *                      relay stays in the set until settle()/error() is called
 *                      or its timer expires — so the set never transiently
 *                      hits zero during an extend() call.
 *
 *   settle(relayId)  — relay finished cleanly (EOSE with no more pages, or
 *                      final pagination block done). Cancels any active
 *                      extension for this relay and marks it done.
 *
 *   error(relayId)   — relay failed (connection error, exhausted retries).
 *                      Cancels any active extension and marks relay done.
 *
 * Firing rules — whichever comes first:
 *
 *   1. Immediate  — all relay IDs have called settle() or error(). Requires
 *                   relayIds to be provided upfront.
 *
 *   2. Debounce   — settleTime ms after the first settle() call, once the
 *                   active extensions set is empty. If extensions are still
 *                   active when settleTime elapses, waits until the set
 *                   empties (driven by extension timer expiry or settle/error
 *                   calls). A new extend() after settleTime+N is handled
 *                   correctly because the set is watched continuously —
 *                   extend() adds to the set before the old timer is cleared,
 *                   so the size never transiently hits zero mid-extend.
 *
 *   3. Hard cap   — maxSettleTime ms after makeSettleSignal() was called.
 *                   Cancels all pending timers and fires regardless of active
 *                   extensions or unsettled relays.
 *
 * When relayIds is omitted (dynamic relay sets), only rules 2 and 3 apply.
 */

import { BehaviorSubject, Observable, Subject, merge, timer } from "rxjs";
import { delay, filter, map, switchMap, take } from "rxjs/operators";

/** Default debounce window in ms */
export const DEFAULT_SETTLE_TIME = 200;

/** Default hard cap in ms — EOSE fires at most this long after creation */
export const DEFAULT_MAX_SETTLE_TIME = 5_000;

export interface SettleSignalOptions {
  /** Debounce window in ms (default 200) */
  settleTime?: number;
  /** Hard cap in ms from creation (default 5000) */
  maxSettleTime?: number;
  /**
   * Known relay IDs contributing to this signal. When provided, EOSE fires
   * immediately once every relay has called settle() or error().
   * When omitted, only the debounce and hard cap apply.
   */
  relayIds?: string[];
}

export interface SettleSignal {
  /**
   * Call when a relay is starting a new page request. Adds the relay to the
   * active extensions set and resets its per-relay timer to now+settleTime.
   * Multiple calls keep pushing the deadline forward without ever transiently
   * removing the relay from the set.
   */
  extend(relayId: string): void;
  /**
   * Call when a relay finishes cleanly (EOSE with no more pages, or final
   * pagination block done). Cancels any active extension and marks relay done.
   */
  settle(relayId: string): void;
  /**
   * Call when a relay fails (connection error, exhausted retries). Cancels
   * any active extension and marks relay done (as failed).
   */
  error(relayId: string): void;
  /**
   * Observable that emits "EOSE" exactly once, per the firing rules above.
   * Merge this into the event stream to expose the settle signal.
   */
  eose$: Observable<"EOSE">;
}

/**
 * Create a settle signal.
 */
export function makeSettleSignal(opts: SettleSignalOptions = {}): SettleSignal {
  const settleTime = opts.settleTime ?? DEFAULT_SETTLE_TIME;
  const maxSettleTime = opts.maxSettleTime ?? DEFAULT_MAX_SETTLE_TIME;
  const relayIds = opts.relayIds;

  // Tracks relays with active page requests. Size is watched to detect when
  // all extensions have cleared. Never transiently hits zero during extend().
  const extensionSize$ = new BehaviorSubject<number>(0);
  const activeExtensions = new Map<string, ReturnType<typeof setTimeout>>();

  // Fires when the first settle() call is made — starts the debounce clock.
  const firstSettle$ = new Subject<void>();
  let firstSettleSeen = false;

  // Tracks relays that have called settle() or error().
  const doneRelays = new Set<string>();

  // Rule 1: immediate — fires when all relay IDs are accounted for.
  const allSettled$ = new Subject<void>();

  const checkAllDone = () => {
    if (relayIds && relayIds.every((id) => doneRelays.has(id))) {
      allSettled$.next();
      allSettled$.complete();
    }
  };

  const cancelExtension = (relayId: string) => {
    const existing = activeExtensions.get(relayId);
    if (existing !== undefined) {
      clearTimeout(existing);
      activeExtensions.delete(relayId);
      extensionSize$.next(activeExtensions.size);
    }
  };

  // Rule 3: hard cap — fires maxSettleTime ms after creation.
  const cap$: Observable<"EOSE"> = timer(maxSettleTime).pipe(
    map(() => "EOSE" as const),
  );

  // Rule 2: settleTime ms after first settle(), wait for extensions to clear.
  const debounce$: Observable<"EOSE"> = firstSettle$.pipe(
    take(1),
    delay(settleTime),
    switchMap(() =>
      extensionSize$.pipe(
        filter((size) => size === 0),
        take(1),
      ),
    ),
    map(() => "EOSE" as const),
  );

  let eose$: Observable<"EOSE">;

  if (relayIds !== undefined && relayIds.length === 0) {
    // No relays — settle immediately.
    eose$ = new Observable<"EOSE">((subscriber) => {
      subscriber.next("EOSE");
      subscriber.complete();
    });
    return {
      extend: () => {},
      settle: () => {},
      error: () => {},
      eose$,
    };
  }

  if (relayIds !== undefined) {
    eose$ = merge(
      allSettled$.pipe(map(() => "EOSE" as const)),
      debounce$,
      cap$,
    ).pipe(take(1));
  } else {
    eose$ = merge(debounce$, cap$).pipe(take(1));
  }

  return {
    extend(relayId: string): void {
      // Cancel existing timer but keep relay in set before adding new timer —
      // this ensures size never transiently hits zero during an extend() call.
      const existing = activeExtensions.get(relayId);
      if (existing !== undefined) clearTimeout(existing);

      const t = setTimeout(() => {
        activeExtensions.delete(relayId);
        extensionSize$.next(activeExtensions.size);
      }, settleTime);

      activeExtensions.set(relayId, t);
      // Only emit size change if this is a new entry (not a reset).
      if (existing === undefined) {
        extensionSize$.next(activeExtensions.size);
      }
    },

    settle(relayId: string): void {
      cancelExtension(relayId);
      doneRelays.add(relayId);
      if (!firstSettleSeen) {
        firstSettleSeen = true;
        firstSettle$.next();
        firstSettle$.complete();
      }
      checkAllDone();
    },

    error(relayId: string): void {
      cancelExtension(relayId);
      doneRelays.add(relayId);
      checkAllDone();
    },

    eose$,
  };
}
