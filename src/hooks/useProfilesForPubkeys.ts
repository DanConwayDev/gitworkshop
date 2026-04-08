import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { profileLoader } from "@/services/nostr";
import { merge } from "rxjs";
import { map, scan, startWith } from "rxjs/operators";
import { getProfileContent, isValidProfile } from "applesauce-core/helpers";
import type { ProfileContent } from "applesauce-core/helpers";

/**
 * Batch-fetch kind:0 profile metadata for a list of pubkeys.
 *
 * Delegates fetching to the singleton profileLoader (createAddressLoader with
 * a 200ms buffer) so all per-pubkey requests across the entire app are batched
 * into a single relay REQ per window. Only pubkeys whose kind:0 is not already
 * in the EventStore are submitted to the loader.
 *
 * Returns a reactive map of pubkey → ProfileContent that updates as profiles
 * arrive. Uses merge+scan so cached profiles appear immediately on first render
 * and the map grows incrementally rather than waiting for every pubkey.
 *
 * Returns an empty Map while no profiles have arrived yet.
 *
 * @param pubkeys - Array of hex pubkeys to fetch profiles for
 */
export function useProfilesForPubkeys(
  pubkeys: string[],
): Map<string, ProfileContent> {
  // Stable key so use$ only re-subscribes when the pubkey set actually changes
  const pubkeyKey = useMemo(() => [...pubkeys].sort().join(","), [pubkeys]);

  const store = useEventStore();

  // Submit missing pubkeys to the singleton profileLoader.
  // The loader batches all calls within its 200ms window into a single REQ,
  // so multiple components mounting simultaneously produce one relay request.
  // Pubkeys already in the EventStore are skipped to avoid redundant fetches.
  // Fire-and-forget — events land in the store as a side-effect.
  use$(() => {
    if (pubkeys.length === 0) return undefined;

    const missing = pubkeys.filter((pk) => !store.getReplaceable(0, pk));
    if (missing.length === 0) return undefined;

    return merge(
      ...missing.map((pk) => profileLoader({ kind: 0, pubkey: pk })),
    );
  }, [pubkeyKey, store]);

  // Reactively read profiles from the store as they arrive, accumulating into
  // a Map. We seed the initial map synchronously from the store cache so that
  // profiles already in the EventStore (from nostrdb or prior fetches) are
  // available immediately on the first render without waiting for any network
  // response.
  const profileMap = use$(() => {
    if (pubkeys.length === 0) return undefined;

    // Seed: read whatever is already cached in the store right now.
    const initial = new Map<string, ProfileContent>();
    for (const pubkey of pubkeys) {
      const ev = store.getReplaceable(0, pubkey);
      if (ev && isValidProfile(ev)) {
        const content = getProfileContent(ev);
        if (content) initial.set(pubkey, content);
      }
    }

    // Subscribe to each pubkey's replaceable kind:0 observable and merge
    // them into a single stream of [pubkey, ProfileContent] pairs.
    const streams = pubkeys.map((pubkey) =>
      store
        .replaceable(0, pubkey)
        .pipe(
          map((ev) =>
            ev && isValidProfile(ev)
              ? ([pubkey, getProfileContent(ev)] as const)
              : null,
          ),
        ),
    );

    return merge(...streams).pipe(
      // Accumulate into a Map — each emission updates one entry.
      scan((acc, entry) => {
        if (!entry) return acc;
        const [pubkey, profile] = entry;
        if (!profile) return acc;
        const next = new Map(acc);
        next.set(pubkey, profile);
        return next;
      }, initial),
      // Emit the seeded map immediately so the first render has cached data.
      startWith(initial),
    );
  }, [pubkeyKey, store]);

  return profileMap ?? new Map<string, ProfileContent>();
}
