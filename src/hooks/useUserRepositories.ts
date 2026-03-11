import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { castTimelineStream } from "applesauce-common/observable";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import { pool } from "@/services/nostr";
import { REPO_KIND, NGIT_RELAYS } from "@/lib/nip34";
import { Repository } from "@/casts/Repository";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";

/**
 * Fetch repository announcements (kind 30617) authored by a specific pubkey.
 *
 * Layer 1: relay fetch — loads all 30617 events by this author into the store.
 * Layer 2: store subscription — casts matching events to Repository instances.
 *
 * @param pubkey - The user's hex pubkey, or undefined to skip
 * @returns Repository[] when loaded, undefined while loading
 */
export function useUserRepositories(
  pubkey: string | undefined,
): Repository[] | undefined {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  // Layer 1: fetch from relay
  use$(() => {
    if (!pubkey) return undefined;
    const filters: Filter[] = [
      { kinds: [REPO_KIND], authors: [pubkey], limit: 100 },
    ];
    return pool
      .req(NGIT_RELAYS, filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [pubkey, store]);

  // Layer 2: subscribe to store and cast
  return use$(() => {
    if (!pubkey) return undefined;
    const filters: Filter[] = [
      { kinds: [REPO_KIND], authors: [pubkey] } as Filter,
    ];
    return store
      .timeline(filters)
      .pipe(castTimelineStream(Repository, castStore)) as unknown as Observable<
      Repository[]
    >;
  }, [pubkey, store]);
}
