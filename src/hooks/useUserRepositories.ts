import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { pool } from "@/services/nostr";
import { REPO_KIND, NGIT_RELAYS, type ResolvedRepo } from "@/lib/nip34";
import { RepositoryListModel } from "@/models/RepositoryListModel";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";

/**
 * Fetch repository announcements authored by a specific user and return them
 * as resolved repositories with the user as the selected maintainer.
 *
 * We request kind 30617 filtered by `authors: [pubkey]` so we only receive
 * events the user themselves published. The user is therefore always the
 * selectedMaintainer anchor for BFS resolution.
 *
 * Layer 1: relay fetch — loads this user's 30617 events into the EventStore.
 * Layer 2: RepositoryListModel(pubkey) — reactive BFS grouping scoped to
 *          repos where this pubkey has an announcement.
 *
 * @param pubkey - The user's hex pubkey, or undefined to skip
 * @returns ResolvedRepo[] when loaded, undefined while loading
 */
export function useUserRepositories(
  pubkey: string | undefined,
): ResolvedRepo[] | undefined {
  const store = useEventStore();

  // Layer 1: fetch only this user's repo announcements from the relay.
  // Filtering by authors ensures the user is the selected maintainer anchor
  // for every result, which is the correct behaviour for a user profile page.
  use$(() => {
    if (!pubkey) return undefined;
    return pool
      .req(NGIT_RELAYS, [{ kinds: [REPO_KIND], authors: [pubkey] } as Filter])
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [pubkey, store]);

  // Layer 2: subscribe to the model scoped to this pubkey.
  return use$(() => {
    if (!pubkey) return undefined;
    return store.model(RepositoryListModel, pubkey) as unknown as Observable<
      ResolvedRepo[]
    >;
  }, [pubkey, store]);
}
