/**
 * withGapFill
 *
 * Wraps an existing subscription observable (e.g. from RelayGroup.subscription())
 * with foreground resume gap-fill. Used for RelayGroup.subscription() calls
 * where we can't replace the inner subscription but can augment the output.
 *
 * On foreground resume, fires a one-shot pool.subscription() against the
 * provided relays with since: lastReceivedAt - gapFillBuffer, merges results
 * into the stream.
 *
 * The relays parameter can be a static array or a snapshot function (called
 * at resume time) — useful for RelayGroup where the relay set may have grown
 * since the subscription was opened.
 */

import type { RelayPool } from "applesauce-relay";
import { completeOnEose, onlyEvents } from "applesauce-relay";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import { Observable, merge } from "rxjs";
import { tap } from "rxjs/operators";
import { foregroundResume$ } from "./foregroundResume";

export type ResilientSubscriptionResponse = NostrEvent | "EOSE";

export interface WithGapFillOptions {
  /** Gap-fill overlap buffer in seconds. Default: 600 (10 minutes) */
  gapFillBuffer?: number;
}

/**
 * Wraps an existing subscription observable with foreground resume gap-fill.
 *
 * @param source$  - The existing subscription observable to augment
 * @param pool     - RelayPool instance for gap-fill requests
 * @param relays   - Static relay array or snapshot function called at resume time
 * @param filters  - Filters to use for gap-fill (same as the original subscription)
 * @param opts     - Options
 */
export function withGapFill(
  source$: Observable<ResilientSubscriptionResponse>,
  pool: RelayPool,
  relays: string[] | (() => string[]),
  filters: Filter[],
  opts: WithGapFillOptions = {},
): Observable<ResilientSubscriptionResponse> {
  const gapFillBuffer = opts.gapFillBuffer ?? 600;

  return new Observable<ResilientSubscriptionResponse>((subscriber) => {
    let lastReceivedAt: number | undefined;
    let gapFillSub: { unsubscribe(): void } | undefined;

    // Track lastReceivedAt from events flowing through source$
    const sourceSub = source$
      .pipe(
        tap((msg) => {
          if (msg !== "EOSE") {
            const t = (msg as NostrEvent).created_at;
            if (lastReceivedAt === undefined || t > lastReceivedAt) {
              lastReceivedAt = t;
            }
          }
        }),
      )
      .subscribe({
        next: (msg) => subscriber.next(msg),
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });

    // On foreground resume, fire a one-shot gap-fill REQ
    const resumeSub = foregroundResume$.subscribe(() => {
      if (lastReceivedAt === undefined) return;

      // Get current relay snapshot
      const currentRelays = typeof relays === "function" ? relays() : relays;
      if (currentRelays.length === 0) return;

      gapFillSub?.unsubscribe();

      const gapFilters: Filter[] = filters.map((f) => ({
        ...f,
        since: lastReceivedAt! - gapFillBuffer,
      }));

      gapFillSub = pool
        .subscription(currentRelays, gapFilters, { reconnect: false })
        .pipe(completeOnEose(), onlyEvents())
        .subscribe({
          next: (event) => subscriber.next(event),
          error: () => {
            /* gap-fill errors are non-fatal */
          },
        });
    });

    return () => {
      sourceSub.unsubscribe();
      resumeSub.unsubscribe();
      gapFillSub?.unsubscribe();
    };
  });
}

// Re-export for convenience — callers can merge gap-fill streams directly
export { merge };
