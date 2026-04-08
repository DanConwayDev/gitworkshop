import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { profileLoader } from "@/services/nostr";

/**
 * Trigger a profile fetch for a single pubkey via the singleton profileLoader.
 *
 * Fire-and-forget: subscribes to profileLoader so the kind:0 event lands in
 * the EventStore, where reactive hooks (useProfile, useUser) will pick it up
 * automatically. If the profile is already in the store the loader is skipped.
 *
 * All calls within the same 200ms window are batched by the singleton loader
 * into a single relay REQ, so mounting many components that each call
 * useLoadProfile produces one request rather than N.
 *
 * Use this in leaf components that render a single user (UserAvatar, UserName,
 * UserLink, etc.) so profiles are fetched on demand without each component
 * needing to know about relay configuration.
 *
 * @param pubkey - Hex pubkey to load, or undefined to skip
 */
export function useLoadProfile(pubkey: string | undefined): void {
  const store = useEventStore();

  use$(() => {
    if (!pubkey) return undefined;
    // Skip if already cached — profileLoader deduplicates relay responses
    // but we avoid the call entirely to save the batching overhead.
    if (store.getReplaceable(0, pubkey)) return undefined;
    return profileLoader({ kind: 0, pubkey });
  }, [pubkey, store]);
}
