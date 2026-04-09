/**
 * searchForEvent
 *
 * A self-contained RxJS observable factory that searches for a specific Nostr
 * event across an ordered sequence of relay groups. It emits a rich stream of
 * discriminated-union status signals so consumers can build detailed UIs
 * (per-relay status indicators, group labels, deletion/vanish detection).
 *
 * Design:
 *   - Groups are tried in order. The first group starts immediately; later
 *     groups activate only after the previous group is exhausted (all relays
 *     hit EOSE without finding the event).
 *   - Within a group, relays$ is reactive — if the observable emits new relay
 *     URLs while the group is active, those relays are added to the search.
 *   - Once any relay finds the event, the search completes (no further groups
 *     are activated).
 *   - After all groups are exhausted without finding the event, a deletion
 *     check (kind:5) and vanish check (kind:62 / NIP-62) are fired
 *     automatically if the author pubkey is known.
 *   - A settle signal (200ms debounce after first relay EOSE) triggers the
 *     deletion/vanish check early — we don't wait for all relays to finish.
 *
 * This is NOT a hook. It's a pure RxJS factory consumed via use$() in hooks.
 */

import type { RelayPool } from "applesauce-relay";
import { completeOnEose, onlyEvents } from "applesauce-relay";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import { Observable, Subject, Subscription, EMPTY } from "rxjs";
import {
  take,
  map,
  takeUntil,
  debounceTime,
  distinctUntilChanged,
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

/** A named group of relays to search, tried in sequence. */
export interface RelayGroupSpec {
  /** Human-readable label for UI display (e.g. "repo relays", "git index") */
  label: string;
  /** Reactive list of relay URLs. The group activates when this emits. */
  relays$: Observable<string[]>;
}

/** Per-relay status in the search. */
export type RelaySearchStatus =
  | "connecting"
  | "searching"
  | "eose"
  | "found"
  | "error";

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
  | { type: "relay-error"; relay: string; group: string; error: Error }
  | { type: "group-exhausted"; group: string }
  | { type: "deletion-found"; event: NostrEvent }
  | { type: "vanish-found"; event: NostrEvent }
  | { type: "concluded-not-found" };

export interface SearchForEventOptions {
  /** Settle debounce window in ms. Default: 200 */
  settleTime?: number;
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
      // kind:5 referencing this event ID
      filters.push({ kinds: [5], "#e": [target.id] } as Filter);
      break;
    case "address": {
      // kind:5 from the author referencing this coordinate
      const coord = `${target.kind}:${target.pubkey}:${target.dTag}`;
      filters.push({
        kinds: [5],
        authors: [target.pubkey],
        "#a": [coord],
      } as Filter);
      break;
    }
    case "profile":
      // Profiles aren't deleted via kind:5 in practice
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
 * Search for a specific Nostr event across ordered relay groups.
 *
 * @param pool     - RelayPool instance
 * @param target   - What to search for (event by ID, addressable event, or profile)
 * @param groups   - Ordered relay groups to search (tried sequentially)
 * @param opts     - Options
 * @returns Observable of SearchSignal — subscribe via use$()
 */
export function searchForEvent(
  pool: RelayPool,
  target: SearchTarget,
  groups: RelayGroupSpec[],
  opts: SearchForEventOptions = {},
): Observable<SearchSignal> {
  if (groups.length === 0) return EMPTY;

  const settleTime = opts.settleTime ?? 200;
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
    // Process a single relay group
    // -----------------------------------------------------------------------
    function processGroup(groupIndex: number): void {
      if (found || groupIndex >= groups.length) {
        if (!found) {
          // All groups exhausted — run deletion/vanish check then conclude
          runDeletionCheck();
        }
        return;
      }

      const group = groups[groupIndex];
      const groupLabel = group.label;

      // Per-relay tracking within this group
      const activeRelays = new Set<string>();
      const eoseRelays = new Set<string>();
      const subscribedRelays = new Set<string>();

      // Settle signal for this group: debounce EOSE across relays
      const relayEose$ = new Subject<void>();
      const settled$ = relayEose$.pipe(debounceTime(settleTime), take(1));

      // When settled, fire deletion check if event not found yet
      const settleSub = settled$.subscribe(() => {
        if (!found) {
          runDeletionCheck();
        }
      });
      teardown.add(settleSub);

      // Subscribe to a single relay within this group
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

        // Open a per-relay subscription so we get per-relay EOSE
        const sub = pool
          .subscription([relayUrl], [searchFilter], { reconnect: false })
          .pipe(takeUntil(found$))
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
                relayEose$.next();

                // Check if all relays in this group have reported EOSE
                if (
                  activeRelays.size === 0 &&
                  subscribedRelays.size === eoseRelays.size
                ) {
                  checkGroupExhausted();
                }
              } else {
                // Got an event
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
              subscriber.next({
                type: "relay-error",
                relay: relayUrl,
                group: groupLabel,
                error: err instanceof Error ? err : new Error(String(err)),
              });
              relayEose$.next(); // treat error as "done" for settle purposes

              // Check if all relays in this group are done
              if (activeRelays.size === 0 && subscribedRelays.size > 0) {
                checkGroupExhausted();
              }
            },
          });

        teardown.add(sub);

        // Emit "searching" once the subscription is open
        // (pool.subscription opens the connection synchronously in the
        // subscribe call, so by this point we're connected or connecting)
        if (!found) {
          subscriber.next({
            type: "relay-searching",
            relay: relayUrl,
            group: groupLabel,
          });
        }
      }

      // Track whether we've already declared this group exhausted
      let groupExhausted = false;

      function checkGroupExhausted(): void {
        if (groupExhausted || found) return;
        // Only exhaust if all subscribed relays have either EOSE'd or errored
        const allDone = subscribedRelays.size > 0 && activeRelays.size === 0;
        if (!allDone) return;

        groupExhausted = true;
        subscriber.next({ type: "group-exhausted", group: groupLabel });

        // Move to next group
        processGroup(groupIndex + 1);
      }

      // Subscribe to the reactive relay list for this group
      const relaySub = group.relays$
        .pipe(
          // Flatten to deduplicated URL list
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
              // Empty group — exhaust immediately if no relays subscribed yet
              if (subscribedRelays.size === 0) {
                groupExhausted = true;
                subscriber.next({
                  type: "group-exhausted",
                  group: groupLabel,
                });
                processGroup(groupIndex + 1);
              }
              return;
            }
            for (const url of urls) {
              subscribeToRelay(url);
            }
          },
          error: () => {
            // If the relay list observable errors, exhaust the group
            if (!groupExhausted && !found) {
              groupExhausted = true;
              subscriber.next({
                type: "group-exhausted",
                group: groupLabel,
              });
              processGroup(groupIndex + 1);
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
        // Nothing to check — conclude immediately
        concludeNotFound();
        return;
      }

      // Deduplicate relay URLs
      const relays = [...new Set(allRelaysSearched)];

      // One-shot request: complete on EOSE
      const sub = pool
        .subscription(relays, allFilters, { reconnect: false })
        .pipe(completeOnEose(), onlyEvents(), takeUntil(found$))
        .subscribe({
          next: (event) => {
            if (found) return;
            if (event.kind === 62) {
              // NIP-62 vanish request — check if it covers relays we searched
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
            // Deletion check failure is non-fatal — just conclude
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
    processGroup(0);

    return teardown;
  });
}
