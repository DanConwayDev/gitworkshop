/**
 * Settle signal helpers
 *
 * A "settle signal" is the pattern used by createPaginatedTagValueLoader to
 * emit an "EOSE" sentinel once all in-flight relay work has quieted down:
 *
 *   1. Create a Subject<void> called settled$.
 *   2. Each relay pushes to settled$ when it finishes its current work
 *      (EOSE received and no pagination needed, or pagination complete).
 *   3. settled$ is debounced by settleTime ms so that a burst of relays
 *      finishing close together produces only one "EOSE" emission.
 *
 * makeSettleSignal() encapsulates steps 1–3 and returns both the subject
 * (for callers to push to) and the ready-to-merge EOSE observable.
 */

import { Subject } from "rxjs";
import { debounceTime, map } from "rxjs/operators";
import type { Observable } from "rxjs";

/** Default debounce window in ms — matches createPaginatedTagValueLoader */
export const DEFAULT_SETTLE_TIME = 200;

export interface SettleSignal {
  /** Push to this when a relay finishes its current work */
  settled$: Subject<void>;
  /**
   * Observable that emits "EOSE" once, settleTime ms after the last push to
   * settled$. Merge this into the event stream to expose the settle signal.
   */
  eose$: Observable<"EOSE">;
}

/**
 * Create a paired (settled$, eose$) settle signal.
 *
 * @param settleTime - Debounce window in ms (default 200)
 */
export function makeSettleSignal(
  settleTime: number = DEFAULT_SETTLE_TIME,
): SettleSignal {
  const settled$ = new Subject<void>();
  const eose$: Observable<"EOSE"> = settled$.pipe(
    debounceTime(settleTime),
    map(() => "EOSE" as const),
  );
  return { settled$, eose$ };
}
