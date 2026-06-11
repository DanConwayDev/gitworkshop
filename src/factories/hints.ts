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
 *
 * ## Why the EventStore is injected, not imported
 *
 * Importing `@/services/nostr` for its `eventStore` singleton at module-eval
 * time would drag the whole service graph (RelayPool, IndexedDB cache, settings)
 * into anything that touches a factory — including node-side e2e tests and any
 * non-browser context. Those modules connect to production relays and touch
 * browser-only globals on load.
 *
 * Instead `services/nostr.ts` calls `setHintEventStore(eventStore)` once at
 * startup. Contexts that never register a store (e.g. the e2e harness) simply
 * get `undefined` hints — which is the documented fallback for these resolvers
 * anyway, so production behaviour is unchanged.
 */

import { getSeenRelays } from "applesauce-core/helpers/relays";
import { MailboxesModel } from "applesauce-core/models";
import { firstValueFrom, of, timeout } from "rxjs";
import type { EventStore } from "applesauce-core";

/**
 * The EventStore used to resolve relay hints. Registered lazily by
 * `services/nostr.ts` so this module has no static dependency on the service
 * graph. `undefined` until registered → hints resolve to `undefined`.
 */
let hintEventStore: EventStore | undefined;

/** Register the EventStore used for relay-hint lookups. Called once at startup. */
export function setHintEventStore(store: EventStore): void {
  hintEventStore = store;
}

/**
 * Resolve a relay hint for an event id by looking it up in the EventStore
 * and picking the first relay that delivered it.
 *
 * Returns `undefined` when no store is registered, the event isn't in the
 * store, or it has no "seen on" metadata.
 */
export async function getEventRelayHint(
  id: string,
): Promise<string | undefined> {
  if (!hintEventStore) return undefined;
  const event = hintEventStore.getEvent(id);
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
 * first emission with a short timeout. Returns `undefined` if no store is
 * registered, the user has no mailboxes, or the model doesn't emit in time.
 */
export async function getPubkeyRelayHint(
  pubkey: string,
): Promise<string | undefined> {
  if (!hintEventStore) return undefined;
  try {
    const mailboxes = await firstValueFrom(
      hintEventStore
        .model(MailboxesModel, pubkey)
        .pipe(timeout({ first: 250, with: () => of(undefined) })),
    );
    return mailboxes?.outboxes?.[0];
  } catch {
    return undefined;
  }
}
