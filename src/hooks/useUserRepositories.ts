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
 * Fetch repository announcements for a specific user and return them as
 * fully-resolved repositories (with multi-maintainer BFS chain resolution).
 *
 * The given pubkey is used as the trusted maintainer for each repo, so the
 * resulting ResolvedRepo objects include co-maintainers discovered via BFS.
 *
 * Layer 1: relay fetch — loads all 30617 events into the EventStore.
 *          We fetch ALL repo events (not just this author's) so that
 *          co-maintainer announcements are available for BFS resolution.
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

  // Layer 1: fetch all repo announcements from the relay into the store.
  // We need all events (not just this author's) so BFS can discover
  // co-maintainer announcements.
  use$(
    () =>
      pool
        .req(NGIT_RELAYS, [{ kinds: [REPO_KIND], limit: 200 } as Filter])
        .pipe(onlyEvents(), mapEventsToStore(store)),
    [store],
  );

  // Layer 2: subscribe to the model scoped to this pubkey.
  return use$(() => {
    if (!pubkey) return undefined;
    return store.model(RepositoryListModel, pubkey) as unknown as Observable<
      ResolvedRepo[]
    >;
  }, [pubkey, store]);
}
