import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { pool } from "@/services/nostr";
import { lookupRelays } from "@/services/settings";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { merge } from "rxjs";
import { map, scan, startWith } from "rxjs/operators";
import { getProfileContent, isValidProfile } from "applesauce-core/helpers";
import type { ProfileContent } from "applesauce-core/helpers";
import type { Filter } from "applesauce-core/helpers";

/**
 * Batch-fetch kind:0 profile metadata for a list of pubkeys.
 *
 * Subscribes to the lookup relays (purplepag.es, etc.) for all provided
 * pubkeys in a single REQ, adds events to the EventStore, then returns a
 * reactive map of pubkey → ProfileContent. The map updates as profiles arrive.
 *
 * The git index relay only stores kind:30617 repo announcements, so we use
 * the dedicated lookup/profile-aggregator relays instead.
 *
 * Uses merge+scan rather than combineLatest so the map is populated
 * incrementally — cached profiles appear immediately on first render and
 * the map grows as network responses arrive, rather than waiting for every
 * pubkey to have a profile before emitting anything.
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

  // Fire a single subscription for all pubkeys against the lookup relays.
  // These are profile-aggregator relays (purplepag.es, etc.) that store kind:0.
  // This is fire-and-forget — we just want the events in the store.
  use$(() => {
    if (pubkeys.length === 0) return undefined;

    const relays = lookupRelays.getValue();
    const filter: Filter = { kinds: [0], authors: pubkeys };

    return pool
      .subscription(relays, [filter])
      .pipe(onlyEvents(), mapEventsToStore(store));
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
