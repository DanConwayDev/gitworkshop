/**
 * Relay hint resolvers for factory calls.
 *
 * In Applesauce v6 the `EventFactory` no longer accepts a global
 * `getEventRelayHint` / `getPubkeyRelayHint` callback on construction.
 * Instead, the tag-operation helpers (`addProfilePointerTag`,
 * `addEventPointerTag`, `addAddressPointerTag`) each take an optional
 * `relayHint` argument — either a string or an async resolver function.
 *
 * This module exports two reusable resolver functions that our factories
 * pass per-call to those helpers. They look up hints from:
 *
 *   - `getEventRelayHint(id)`  — the EventStore's "seen on" metadata
 *   - `getPubkeyRelayHint(pk)` — the user's NIP-65 outbox mailbox list
 *
 * Both functions are async to satisfy the resolver signature
 * `(id: string) => Promise<string | undefined>` expected by the tag helpers.
 */

import { getSeenRelays } from "applesauce-core/helpers/relays";
import { MailboxesModel } from "applesauce-core/models";
import { firstValueFrom, of, timeout } from "rxjs";
import { eventStore } from "@/services/nostr";

/**
 * Resolve a relay hint for an event id by looking it up in the EventStore
 * and picking the first relay that delivered it.
 *
 * Returns `undefined` when the event isn't in the store or has no
 * "seen on" metadata.
 */
export async function getEventRelayHint(
  id: string,
): Promise<string | undefined> {
  const event = eventStore.getEvent(id);
  if (!event) return undefined;
  const seen = getSeenRelays(event);
  if (!seen) return undefined;
  const first = [...seen][0];
  return first ?? undefined;
}

/**
 * Resolve a relay hint for a pubkey by reading their NIP-65 mailboxes
 * (kind 10002) via `MailboxesModel` and picking the first outbox (write)
 * relay.
 *
 * The mailbox model is reactive, but we want a snapshot — so we take the
 * first emission with a short timeout. Returns `undefined` if the user has
 * no mailboxes in the store or the model doesn't emit within the timeout.
 */
export async function getPubkeyRelayHint(
  pubkey: string,
): Promise<string | undefined> {
  try {
    const mailboxes = await firstValueFrom(
      eventStore
        .model(MailboxesModel, pubkey)
        .pipe(timeout({ first: 250, with: () => of(undefined) })),
    );
    return mailboxes?.outboxes?.[0];
  } catch {
    return undefined;
  }
}
