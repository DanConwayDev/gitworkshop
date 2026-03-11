import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { pool } from "@/services/nostr";
import { REPO_KIND, NGIT_RELAYS, type ResolvedRepo } from "@/lib/nip34";
import { RepositoryModel } from "@/models/RepositoryModel";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";

/**
 * Fetch and reactively resolve a single repository by selected maintainer
 * pubkey + d-tag.
 *
 * Layer 1: fetch the selected maintainer's announcement from the relay.
 *          The EventStore's addressLoader (wired in nostr.ts) will
 *          automatically fetch any co-maintainer announcements that the
 *          RepositoryModel subscribes to but aren't in the store yet.
 *
 * Layer 2: RepositoryModel — reactive BFS chain resolution. Emits a new
 *          ResolvedRepo whenever any announcement in the chain changes.
 *          Cached by the store — multiple components on the same page share
 *          one model instance.
 */
export function useResolvedRepository(
  pubkey: string | undefined,
  dTag: string | undefined,
): ResolvedRepo | undefined {
  const store = useEventStore();
  const key = `${pubkey}:${dTag}`;

  // Layer 1: seed the store with the selected maintainer's announcement.
  // The RepositoryModel will subscribe to co-maintainer announcements via
  // store.addressable(), which triggers the addressLoader for missing ones.
  use$(() => {
    if (!pubkey || !dTag) return undefined;
    const filter: Filter[] = [
      { kinds: [REPO_KIND], authors: [pubkey], "#d": [dTag] } as Filter,
    ];
    return pool
      .req(NGIT_RELAYS, filter)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [key, store]);

  // Layer 2: subscribe to the model.
  return use$(() => {
    if (!pubkey || !dTag) return undefined;
    return store.model(RepositoryModel, pubkey, dTag) as unknown as Observable<
      ResolvedRepo | undefined
    >;
  }, [key, store]);
}
