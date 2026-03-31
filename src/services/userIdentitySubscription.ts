/**
 * userIdentitySubscription — persistent relay subscription for the active
 * user's own identity events.
 *
 * Keeps a live subscription open on the user's outbox relays (and the
 * configured lookup relays as a fallback) for the four event kinds that
 * define who the user is and where they publish:
 *
 *   kind 0     — profile metadata
 *   kind 3     — contact / follow list  ← most critical for safe follow edits
 *   kind 10002 — NIP-65 relay list (mailboxes)
 *   kind 10317 — Grasp server list
 *
 * Events are piped directly into the EventStore (and therefore the IndexedDB
 * cache via persistEventsToCache) so they are immediately available to any
 * model or action that reads from the store.
 *
 * This is the foundation for the robust follow action: by keeping kind:3
 * continuously up-to-date from ALL of the user's outbox relays, we ensure
 * that a follow/unfollow action always starts from the freshest known state —
 * even if the user updated their contact list on a different client that
 * publishes to relays we haven't queried yet.
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

/** Event kinds that define the user's identity and relay configuration. */
export const USER_IDENTITY_KINDS = [
  0, // profile metadata
  3, // contact / follow list
  10002, // NIP-65 relay list (mailboxes)
  10317, // Grasp server list
] as const;

/**
 * Minimum number of relays we must be able to subscribe to.
 * If the outbox relay list is empty we fall back to lookupRelays.
 */
const MIN_RELAY_COUNT = 1;

/**
 * Open a persistent subscription for the user's identity events on their
 * outbox relays (falling back to lookup relays when none are known yet).
 *
 * Returns a cleanup function — call it when the account changes or logs out.
 */
export function startUserIdentitySubscription(
  pubkey: string,
  outboxRelays: string[],
): () => void {
  // Use outbox relays when available, otherwise fall back to lookup relays
  // so we still get data even before the user's NIP-65 list is loaded.
  const relays =
    outboxRelays.length >= MIN_RELAY_COUNT
      ? outboxRelays
      : lookupRelays.getValue();

  if (relays.length === 0) return () => {};

  const filter: Filter = {
    kinds: [...USER_IDENTITY_KINDS],
    authors: [pubkey],
  };

  const sub: Subscription = pool
    .subscription(relays, [filter], {
      // Stay open indefinitely — reconnect and resubscribe on relay drops
      reconnect: Infinity,
      resubscribe: Infinity,
    })
    .pipe(onlyEvents(), mapEventsToStore(eventStore))
    .subscribe({
      error: (err) => {
        console.warn("[userIdentitySubscription] subscription error:", err);
      },
    });

  return () => sub.unsubscribe();
}
