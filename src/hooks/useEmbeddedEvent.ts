/**
 * useEmbeddedEvent — fetch a single event for embedded preview rendering.
 *
 * Accepts either an event pointer (nevent/note) or an address pointer (naddr).
 * Uses the EventStore's reactive `event()` / `addressable()` subscriptions so
 * the component updates automatically when the event arrives. Fires the
 * appropriate global loader (eventLoader / addressLoader) once on mount to
 * ensure the event is fetched from relays if not already cached.
 *
 * Returns the event once available, or undefined while loading.
 */

import { useEffect } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { eventLoader, addressLoader } from "@/services/nostr";
import type { AddressPointer, EventPointer } from "nostr-tools/nip19";
import type { NostrEvent } from "nostr-tools";

/**
 * Fetch a single event by its event pointer (nevent / note).
 *
 * Fires the global eventLoader once on mount (or when the ID changes) so the
 * event is fetched from relays if not already in the store. Subscribes to the
 * EventStore reactively for the result.
 */
export function useEmbeddedEventById(
  pointer: EventPointer | undefined,
): NostrEvent | undefined {
  const store = useEventStore();
  const id = pointer?.id;

  // Kick off the loader when the pointer changes
  useEffect(() => {
    if (!id) return;
    const sub = eventLoader({
      id,
      relays: pointer?.relays,
      author: pointer?.author,
    }).subscribe();
    return () => sub.unsubscribe();
    // pointer.relays / pointer.author are relay hints — stable enough to
    // stringify for the dep array would be overkill; re-firing on id change is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return use$(() => {
    if (!id) return undefined;
    return store.event(id) as import("rxjs").Observable<NostrEvent | undefined>;
  }, [id, store]);
}

/**
 * Fetch a single addressable event by its address pointer (naddr).
 *
 * Fires the global addressLoader once on mount (or when the pointer changes)
 * so the event is fetched from relays if not already in the store. Subscribes
 * to the EventStore reactively for the result.
 */
export function useEmbeddedEventByAddress(
  pointer: AddressPointer | undefined,
): NostrEvent | undefined {
  const store = useEventStore();

  const pointerKey = pointer
    ? `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`
    : undefined;

  // Kick off the loader when the pointer changes
  useEffect(() => {
    if (!pointer) return;
    const sub = addressLoader(pointer).subscribe();
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointerKey]);

  return use$(() => {
    if (!pointer) return undefined;
    return store.addressable(pointer) as import("rxjs").Observable<
      NostrEvent | undefined
    >;
  }, [pointerKey, store]);
}
