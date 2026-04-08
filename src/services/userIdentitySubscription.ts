/**
 * userIdentitySubscription — persistent relay subscription for the active
 * user's own replaceable events.
 *
 * Keeps a live subscription open on the UNION of the user's outbox relays AND
 * the configured lookup/index relays for all replaceable event kinds that
 * define who the user is, where they publish, and what they follow:
 *
 *   kind 0     — profile metadata
 *   kind 3     — contact / follow list
 *   kind 10002 — NIP-65 relay list (mailboxes)
 *   kind 10017 — NIP-51 Git authors follow list
 *   kind 10018 — NIP-51 Git repositories follow list
 *   kind 10317 — Grasp server list
 *
 * Events are piped directly into the EventStore (and therefore the IndexedDB
 * cache via persistEventsToCache) so they are immediately available to any
 * model or action that reads from the store.
 *
 * This is the foundation for robust replaceable-event actions: by keeping
 * these kinds continuously up-to-date from ALL of the user's outbox relays
 * AND index relays, we ensure that any action that modifies a replaceable
 * event always starts from the freshest known state — even if the user
 * updated the event on a different client that publishes to relays we
 * haven't queried yet.
 *
 * Usage (called from accounts.ts on active account change):
 *
 *   const stop = startUserIdentitySubscription(pubkey, outboxRelays);
 *   // later:
 *   stop();
 */

import { Subscription } from "rxjs";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { eventStore, pool } from "./nostr";
import { lookupRelays } from "./settings";
import type { Filter } from "applesauce-core/helpers";
import { resilientSubscription } from "@/lib/resilientSubscription";

/**
 * All replaceable event kinds that define the user's identity, relay
 * configuration, and list preferences. Any kind added here will be
 * persistently subscribed to for the active user's session.
 *
 * This is the single source of truth — import it from here when you need
 * to check whether a kind is a "user replaceable" kind.
 */
export const USER_REPLACEABLE_KINDS = [
  0, // profile metadata
  3, // contact / follow list
  10002, // NIP-65 relay list (mailboxes)
  10017, // NIP-51 Git authors follow list
  10018, // NIP-51 Git repositories follow list
  10317, // Grasp server list
] as const;

/**
 * Open a persistent subscription for the user's replaceable events on the
 * UNION of their outbox relays and the configured lookup/index relays.
 *
 * Using both relay sets (not one as fallback for the other) ensures we
 * catch updates published from other clients that may have written to
 * index relays but not to all of the user's outbox relays, or vice versa.
 *
 * Returns a cleanup function — call it when the account changes or logs out.
 */
export function startUserIdentitySubscription(
  pubkey: string,
  outboxRelays: string[],
): () => void {
  // Union of outbox relays and lookup/index relays, deduplicated
  const relays = [...new Set([...outboxRelays, ...lookupRelays.getValue()])];

  if (relays.length === 0) return () => {};

  const filter: Filter = {
    kinds: [...USER_REPLACEABLE_KINDS],
    authors: [pubkey],
  };

  // resilientSubscription provides:
  //   - lastReceivedAt-aware reconnect (avoids replaying full relay history)
  //   - foreground resume gap-fill (recovers events missed while backgrounded)
  //   - EOSE settle signal (not critical here but harmless)
  const sub: Subscription = resilientSubscription(pool, relays, [filter], {
    reconnect: true,
    gapFill: true,
    settle: false, // no consumer needs the EOSE signal here
    paginate: false,
  })
    .pipe(onlyEvents(), mapEventsToStore(eventStore))
    .subscribe({
      error: (err) => {
        console.warn("[userIdentitySubscription] subscription error:", err);
      },
    });

  return () => sub.unsubscribe();
}
