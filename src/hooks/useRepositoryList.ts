import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { pool } from "@/services/nostr";
import { REPO_KIND, NGIT_RELAYS, type ResolvedRepo } from "@/lib/nip34";
import { RepositoryListModel } from "@/models/RepositoryListModel";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";

const repoFilter: Filter[] = [{ kinds: [REPO_KIND], limit: 200 }];

/**
 * Fetch all repository announcements from the relay and return a deduplicated
 * list of resolved repositories.
 *
 * Multi-maintainer repos (where pubkeys mutually list each other) are merged
 * into a single ResolvedRepo. The selectedMaintainer on each result is a
 * randomly-selected pubkey from the connected component — good enough for
 * routing to the repo page for now.
 *
 * Layer 1: relay fetch — dumps all 30617 events into the EventStore.
 * Layer 2: RepositoryListModel — reactive BFS grouping over the store.
 *          Shared across all subscribers via the model cache.
 */
export function useRepositoryList(): ResolvedRepo[] | undefined {
  const store = useEventStore();

  // Layer 1: fetch all repo announcements from the relay into the store.
  // Fire-and-forget — no casting, no grouping here.
  use$(
    () =>
      pool
        .subscription(NGIT_RELAYS, repoFilter)
        .pipe(onlyEvents(), mapEventsToStore(store)),
    [store],
  );

  // Layer 2: subscribe to the model — one instance shared across all callers.
  return use$(
    () =>
      store.model(RepositoryListModel) as unknown as Observable<ResolvedRepo[]>,
    [store],
  );
}
