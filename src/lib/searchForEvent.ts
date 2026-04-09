/**
 * searchForEvent
 *
 * A self-contained RxJS observable factory that searches for a specific Nostr
 * event across relay groups split into two tiers.
 *
 * Design:
 *   Tier 1 — "immediate" groups (deferred: false, the default):
 *     All immediate groups start simultaneously the moment the search begins.
 *     Within each group, relays$ is reactive — new URLs emitted while the
 *     group is active are subscribed to immediately.
 *
 *   Tier 2 — "deferred" groups (deferred: true):
 *     Deferred groups activate after a "settle" signal fires on the immediate
 *     tier. The settle signal is the earlier of:
 *       • first relay EOSE/error across any immediate group + settleTime ms
 *       • deferTimeout ms from search start (hard deadline)
 *     Once the settle fires, all deferred groups start simultaneously (same
 *     parallel behaviour as immediate groups).
 *
 *   Completion:
 *     Once any relay finds the event the search completes immediately.
 *     After all groups (both tiers) are exhausted without finding the event,
 *     a deletion check (kind:5) and vanish check (kind:62 / NIP-62) run
 *     automatically if the author pubkey is known.
 *     The settle signal also triggers the deletion check early — we don't
 *     wait for every relay to finish.
 *
 * This is NOT a hook. It's a pure RxJS factory consumed via use$() in hooks.
 */

import type { RelayPool } from "applesauce-relay";
import { completeOnEose, onlyEvents } from "applesauce-relay";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import {
  Observable,
  Subject,
  Subscription,
  EMPTY,
  timer,
  TimeoutError,
} from "rxjs";
import {
  take,
  map,
  takeUntil,
  debounceTime,
  distinctUntilChanged,
  timeout,
} from "rxjs/operators";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** What we're searching for — discriminated union for type-safe filter inference. */
export type SearchTarget =
  | {
      /** Search by event ID (nevent / note) */
      type: "event";
      id: string;
      /** Author pubkey if known (from nevent). Enables vanish check. */
      authorPubkey?: string;
    }
  | {
      /** Search by addressable event coordinate (naddr) */
      type: "address";
      kind: number;
      pubkey: string;
      dTag: string;
    }
  | {
      /** Search for a user profile (kind:0) */
      type: "profile";
      pubkey: string;
    };

/**
 * A named group of relays to search.
 *
 * Immediate groups (deferred: false, default) all start at the same time.
 * Deferred groups (deferred: true) start after the immediate-tier settle
 * signal fires (first EOSE + settleTime ms, or deferTimeout ms, whichever
 * comes first).
 */
export interface RelayGroupSpec {
  /** Human-readable label for UI display (e.g. "repo relays", "git index") */
  label: string;
  /** Reactive list of relay URLs. The group activates when this emits. */
  relays$: Observable<string[]>;
  /**
   * When true this group is held back until the immediate-tier settle fires.
   * Default: false (immediate).
   */
  deferred?: boolean;
}

/** Per-relay status in the search. */
export type RelaySearchStatus =
  | "connecting"
  | "searching"
  | "eose"
  | "found"
  | "error"
  | "connection-failed"
  | "timeout";

/** Discriminated union of all signals emitted by searchForEvent. */
export type SearchSignal =
  | { type: "relay-connecting"; relay: string; group: string }
  | { type: "relay-searching"; relay: string; group: string }
  | { type: "relay-eose"; relay: string; group: string }
  | {
      type: "relay-found";
      relay: string;
      group: string;
      event: NostrEvent;
    }
  | {
      type: "relay-error";
      relay: string;
      group: string;
      error: Error;
      /** "connection-failed" = relay never connected; "timeout" = connected but no response; "error" = other */
      kind: "connection-failed" | "timeout" | "error";
    }
  | { type: "group-exhausted"; group: string }
  | { type: "deletion-found"; event: NostrEvent }
  | { type: "vanish-found"; event: NostrEvent }
  | { type: "concluded-not-found" };

export interface SearchForEventOptions {
  /**
   * Debounce window after the first relay EOSE/error before the settle fires.
   * Default: 200 ms.
   */
  settleTime?: number;
  /**
   * Hard deadline from search start after which the settle fires regardless
   * of whether any relay has responded. Also acts as the maximum wait before
   * deferred groups start.
   * Default: 4000 ms.
   */
  deferTimeout?: number;
  /**
   * Per-relay timeout: if a relay does not emit EOSE or an event within this
   * many milliseconds, it is treated as an error. This handles relays that
   * accept the connection but never respond, or relays that fail to connect
   * and whose req() observable hangs indefinitely.
   * Default: 8000 ms.
   */
  relayTimeout?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the relay filter from a SearchTarget. */
function buildFilter(target: SearchTarget): Filter {
  switch (target.type) {
    case "event":
      return { ids: [target.id] };
    case "address":
      return {
        kinds: [target.kind],
        authors: [target.pubkey],
        "#d": [target.dTag],
      } as Filter;
    case "profile":
      return { kinds: [0], authors: [target.pubkey] };
  }
}

/** Extract the author pubkey from a SearchTarget, if known. */
function getAuthorPubkey(target: SearchTarget): string | undefined {
  switch (target.type) {
    case "event":
      return target.authorPubkey;
    case "address":
    case "profile":
      return target.pubkey;
  }
}

/** Build deletion check filters for a SearchTarget. */
function buildDeletionFilters(target: SearchTarget): Filter[] {
  const filters: Filter[] = [];
  switch (target.type) {
    case "event":
      filters.push({ kinds: [5], "#e": [target.id] } as Filter);
      break;
    case "address": {
      const coord = `${target.kind}:${target.pubkey}:${target.dTag}`;
      filters.push({
        kinds: [5],
        authors: [target.pubkey],
        "#a": [coord],
      } as Filter);
      break;
    }
    case "profile":
      break;
  }
  return filters;
}

/** Build vanish check filter (kind:62) for a pubkey. */
function buildVanishFilter(pubkey: string): Filter {
  return { kinds: [62], authors: [pubkey] };
}

// ---------------------------------------------------------------------------
// Core factory
// ---------------------------------------------------------------------------

/**
 * Search for a specific Nostr event across relay groups.
 *
 * Immediate groups (deferred: false) all start simultaneously.
 * Deferred groups (deferred: true) start after the immediate-tier settle
 * fires (first EOSE + settleTime ms, or deferTimeout ms hard deadline).
 *
 * @param pool   - RelayPool instance
 * @param target - What to search for
 * @param groups - Relay groups (immediate and/or deferred)
 * @param opts   - Options
 */
export function searchForEvent(
  pool: RelayPool,
  target: SearchTarget,
  groups: RelayGroupSpec[],
  opts: SearchForEventOptions = {},
): Observable<SearchSignal> {
  if (groups.length === 0) return EMPTY;

  const settleTime = opts.settleTime ?? 200;
  const deferTimeout = opts.deferTimeout ?? 4000;
  const relayTimeout = opts.relayTimeout ?? 8000;
  const searchFilter = buildFilter(target);

  return new Observable<SearchSignal>((subscriber) => {
    const teardown = new Subscription();
    let found = false;

    // Track all relays we've searched (for deletion/vanish check)
    const allRelaysSearched: string[] = [];

    // Signal to stop everything when the event is found
    const found$ = new Subject<void>();
    teardown.add(() => found$.complete());

    // -----------------------------------------------------------------------
    // Settle signal
    //
    // Fires when the immediate tier has "settled": the earlier of
    //   • first relay EOSE/error across any immediate group + settleTime ms
    //   • deferTimeout ms from now (hard deadline)
    //
    // Used to:
    //   1. Trigger deletion check early (don't wait for all relays)
    //   2. Activate deferred groups
    // -----------------------------------------------------------------------
    const anyImmediateResponse$ = new Subject<void>();
    const settled$ = new Subject<void>();
    let settleFired = false;

    function fireSettle(): void {
      if (settleFired || found) return;
      settleFired = true;
      settled$.next();
      settled$.complete();
      runDeletionCheck();
    }

    // Debounced path: first response + settleTime ms
    const debounceSub = anyImmediateResponse$
      .pipe(debounceTime(settleTime), take(1), takeUntil(found$))
      .subscribe(() => fireSettle());
    teardown.add(debounceSub);

    // Hard deadline path: deferTimeout ms from start
    const timeoutSub = timer(deferTimeout)
      .pipe(takeUntil(found$))
      .subscribe(() => fireSettle());
    teardown.add(timeoutSub);

    // -----------------------------------------------------------------------
    // Track exhausted groups for "all done" detection
    // -----------------------------------------------------------------------
    const immediateGroups = groups.filter((g) => !g.deferred);
    const deferredGroups = groups.filter((g) => g.deferred);

    let immediateExhaustedCount = 0;
    let deferredExhaustedCount = 0;

    function onGroupExhausted(deferred: boolean): void {
      if (deferred) {
        deferredExhaustedCount++;
        if (deferredExhaustedCount >= deferredGroups.length) {
          // All deferred groups done — conclude
          runDeletionCheck();
          // concludeNotFound is called from runDeletionCheck's complete handler
        }
      } else {
        immediateExhaustedCount++;
        if (immediateExhaustedCount >= immediateGroups.length) {
          // All immediate groups done — fire settle now (don't wait for debounce)
          fireSettle();
          if (deferredGroups.length === 0) {
            // No deferred groups — conclude
            runDeletionCheck();
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Start a single relay group
    // -----------------------------------------------------------------------
    function startGroup(group: RelayGroupSpec, isDeferred: boolean): void {
      const groupLabel = group.label;

      const activeRelays = new Set<string>();
      const eoseRelays = new Set<string>();
      const subscribedRelays = new Set<string>();
      let groupExhausted = false;

      function subscribeToRelay(relayUrl: string): void {
        if (subscribedRelays.has(relayUrl) || found) return;
        subscribedRelays.add(relayUrl);
        activeRelays.add(relayUrl);
        allRelaysSearched.push(relayUrl);

        subscriber.next({
          type: "relay-connecting",
          relay: relayUrl,
          group: groupLabel,
        });

        // Track whether the relay ever establishes a WebSocket connection
        // before the timeout fires. We subscribe to connected$ immediately so
        // we capture the very first connection attempt, not the state at
        // timeout time (by which point the relay may have reconnected).
        let everConnected = false;
        const relayInstance = pool.relay(relayUrl);
        const connSub = relayInstance.connected$
          .pipe(takeUntil(found$))
          .subscribe((connected) => {
            if (connected) everConnected = true;
          });
        teardown.add(connSub);

        // Use relayInstance.req() directly instead of pool.req([url]) to
        // bypass RelayGroup.internalSubscription()'s catchError wrapper, which
        // silently converts connection errors into fake EOSE messages — making
        // an unreachable relay look like a successful empty response.
        const sub = relayInstance
          .req([searchFilter])
          .pipe(
            // If the relay doesn't respond within relayTimeout ms, treat it as
            // an error. This handles relays that fail to connect (req() hangs
            // indefinitely because the Relay class catches connection errors
            // internally and retries — it never propagates them to subscribers).
            timeout({ first: relayTimeout }),
            takeUntil(found$),
          )
          .subscribe({
            next: (msg) => {
              if (found) return;

              if (msg === "EOSE") {
                eoseRelays.add(relayUrl);
                activeRelays.delete(relayUrl);
                subscriber.next({
                  type: "relay-eose",
                  relay: relayUrl,
                  group: groupLabel,
                });

                // Nudge the settle debounce for immediate groups
                if (!isDeferred) anyImmediateResponse$.next();

                if (
                  activeRelays.size === 0 &&
                  subscribedRelays.size === eoseRelays.size
                ) {
                  checkGroupExhausted();
                }
              } else {
                const event = msg as NostrEvent;
                if (!found) {
                  found = true;
                  subscriber.next({
                    type: "relay-found",
                    relay: relayUrl,
                    group: groupLabel,
                    event,
                  });
                  found$.next();
                  subscriber.complete();
                }
              }
            },
            error: (err) => {
              activeRelays.delete(relayUrl);
              // Classify the error using the connection history we tracked:
              // - TimeoutError + never connected → connection-failed (unreachable)
              // - TimeoutError + was connected   → timeout (connected but no response)
              // - anything else                  → generic error
              let errorKind: "connection-failed" | "timeout" | "error";
              if (err instanceof TimeoutError) {
                errorKind = everConnected ? "timeout" : "connection-failed";
              } else {
                errorKind = "error";
              }
              subscriber.next({
                type: "relay-error",
                relay: relayUrl,
                group: groupLabel,
                error: err instanceof Error ? err : new Error(String(err)),
                kind: errorKind,
              });

              // Errors also nudge the settle debounce for immediate groups
              if (!isDeferred) anyImmediateResponse$.next();

              if (activeRelays.size === 0 && subscribedRelays.size > 0) {
                checkGroupExhausted();
              }
            },
          });

        teardown.add(sub);

        if (!found) {
          subscriber.next({
            type: "relay-searching",
            relay: relayUrl,
            group: groupLabel,
          });
        }
      }

      function checkGroupExhausted(): void {
        if (groupExhausted || found) return;
        const allDone = subscribedRelays.size > 0 && activeRelays.size === 0;
        if (!allDone) return;

        groupExhausted = true;
        subscriber.next({ type: "group-exhausted", group: groupLabel });
        onGroupExhausted(isDeferred);
      }

      // Subscribe to the reactive relay list
      const relaySub = group.relays$
        .pipe(
          map((urls) => [...new Set(urls)]),
          distinctUntilChanged(
            (a, b) =>
              a.length === b.length && a.every((url, i) => url === b[i]),
          ),
          takeUntil(found$),
        )
        .subscribe({
          next: (urls) => {
            if (found) return;
            if (urls.length === 0) {
              if (subscribedRelays.size === 0) {
                groupExhausted = true;
                subscriber.next({
                  type: "group-exhausted",
                  group: groupLabel,
                });
                onGroupExhausted(isDeferred);
              }
              return;
            }
            for (const url of urls) {
              subscribeToRelay(url);
            }
          },
          error: () => {
            if (!groupExhausted && !found) {
              groupExhausted = true;
              subscriber.next({
                type: "group-exhausted",
                group: groupLabel,
              });
              onGroupExhausted(isDeferred);
            }
          },
        });

      teardown.add(relaySub);
    }

    // -----------------------------------------------------------------------
    // Deletion / vanish check
    // -----------------------------------------------------------------------
    let deletionCheckFired = false;

    function runDeletionCheck(): void {
      if (deletionCheckFired || found) return;
      deletionCheckFired = true;

      const authorPubkey = getAuthorPubkey(target);
      const deletionFilters = buildDeletionFilters(target);
      const vanishFilter = authorPubkey
        ? buildVanishFilter(authorPubkey)
        : undefined;

      const allFilters = [
        ...deletionFilters,
        ...(vanishFilter ? [vanishFilter] : []),
      ];

      if (allFilters.length === 0 || allRelaysSearched.length === 0) {
        concludeNotFound();
        return;
      }

      const relays = [...new Set(allRelaysSearched)];

      const sub = pool
        .req(relays, allFilters)
        .pipe(completeOnEose(), onlyEvents(), takeUntil(found$))
        .subscribe({
          next: (event) => {
            if (found) return;
            if (event.kind === 62) {
              const relayTags = event.tags
                .filter(([t]) => t === "relay")
                .map(([, v]) => v);
              const isGlobal = relayTags.includes("ALL_RELAYS");
              const coversSearched = relayTags.some((r) => relays.includes(r));
              if (isGlobal || coversSearched) {
                subscriber.next({ type: "vanish-found", event });
              }
            } else if (event.kind === 5) {
              subscriber.next({ type: "deletion-found", event });
            }
          },
          error: () => {
            concludeNotFound();
          },
          complete: () => {
            concludeNotFound();
          },
        });

      teardown.add(sub);
    }

    let concluded = false;

    function concludeNotFound(): void {
      if (concluded || found) return;
      concluded = true;
      subscriber.next({ type: "concluded-not-found" });
      subscriber.complete();
    }

    // -----------------------------------------------------------------------
    // Start
    // -----------------------------------------------------------------------

    // All immediate groups start right away, in parallel
    for (const group of immediateGroups) {
      startGroup(group, false);
    }

    // If there are no immediate groups at all, fire settle immediately so
    // deferred groups start without waiting
    if (immediateGroups.length === 0) {
      fireSettle();
    }

    // Deferred groups start once the settle fires
    if (deferredGroups.length > 0) {
      const deferSub = settled$.pipe(take(1)).subscribe(() => {
        if (!found) {
          for (const group of deferredGroups) {
            startGroup(group, true);
          }
        }
      });
      teardown.add(deferSub);
    }

    return teardown;
  });
}
