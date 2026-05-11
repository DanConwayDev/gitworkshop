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
   * Add a new relay to the set of expected relays. The relay is treated as if
   * it had been in relayIds from the start: allSettled$ will not fire until
   * this relay also calls settle() or error(). Has no effect if the relay is
   * already known (settled, errored, or pending).
   *
   * The debounce (rule 2) and hard-cap (rule 3) timers are unaffected — only
   * the immediate-all-done check (rule 1) is extended.
   */
  addRelay(relayId: string): void;
  /**
   * Remove a relay from the set of expected relays. If the relay had not yet
   * settled or errored, it is removed from the pending set so allSettled$ can
   * fire without waiting for it. Any active extension timer for the relay is
   * also cancelled.
   *
   * Has no effect if the relay was never added or has already settled/errored.
   */
  removeRelay(relayId: string): void;
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

  // Mutable set of relay IDs we are waiting for (mirrors relayIds but can grow
  // and shrink via addRelay / removeRelay after construction).
  const pendingRelays = new Set<string>(relayIds);

  // Rule 1: immediate — fires when all relay IDs are accounted for.
  const allSettled$ = new Subject<void>();

  const checkAllDone = () => {
    if (
      relayIds !== undefined &&
      [...pendingRelays].every((id) => doneRelays.has(id))
    ) {
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
      addRelay: () => {},
      removeRelay: () => {},
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

    addRelay(relayId: string): void {
      // No-op if already known (pending, settled, or errored).
      if (pendingRelays.has(relayId) || doneRelays.has(relayId)) return;
      pendingRelays.add(relayId);
      // checkAllDone is intentionally NOT called here — we just added a new
      // pending relay so the set cannot be fully done yet.
    },

    removeRelay(relayId: string): void {
      if (!pendingRelays.has(relayId)) return;
      cancelExtension(relayId);
      // Mark as done so checkAllDone counts it as settled.
      doneRelays.add(relayId);
      pendingRelays.delete(relayId);
      checkAllDone();
    },

    eose$,
  };
}
