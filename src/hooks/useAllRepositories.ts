import { useEffect, useRef, useState } from "react";
import { lastValueFrom, toArray } from "rxjs";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents, completeOnEose } from "applesauce-relay";
import { pool, eventStore } from "@/services/nostr";
import { gitIndexRelays } from "@/services/settings";
import { REPO_KIND, type ResolvedRepo } from "@/lib/nip34";
import { RepositoryListModel } from "@/models/RepositoryListModel";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";

const REPO_FILTER: Filter = { kinds: [REPO_KIND] };
const BATCH_LIMIT = 500;

export interface UseAllRepositoriesResult {
  repos: ResolvedRepo[] | undefined;
  isSyncing: boolean;
}

/**
 * Fetch ALL repository announcements (kind 30617) from the given relays and
 * return a deduplicated list of resolved repositories.
 *
 * Fetch strategy: sequential until-walk — repeatedly REQ { kinds:[30617],
 * limit:500, until } walking backwards through time until a batch returns
 * fewer than BATCH_LIMIT events. Uses pool.req() (no deduplication) so
 * batch.length reflects the true relay-sent count regardless of what the
 * concurrent live subscription has already added to the store.
 *
 * After the bulk fetch completes, a live pool.subscription() keeps the store
 * updated so newly published repos appear in real time.
 *
 * isSyncing is true from mount until the bulk fetch completes (or fails).
 *
 * @param relayOverride - Optional relay URLs to query instead of gitIndexRelays.
 */
export function useAllRepositories(
  relayOverride?: string[],
): UseAllRepositoriesResult {
  const store = useEventStore();
  const [isSyncing, setIsSyncing] = useState(true);

  // Stable relay list — recompute only when override changes
  const relays = relayOverride ?? gitIndexRelays.getValue();
  const relayKey = relays.join(",");

  // Track whether we've already started a bulk fetch for this relay set so
  // React StrictMode double-invocation doesn't fire two parallel syncs.
  const syncedRelayKey = useRef<string | null>(null);

  useEffect(() => {
    if (syncedRelayKey.current === relayKey) return;
    syncedRelayKey.current = relayKey;

    setIsSyncing(true);

    let cancelled = false;

    async function bulkFetch() {
      try {
        // Sequential until-walk: walk backwards through time fetching 500
        // events at a time until the relay returns a partial batch.
        // pool.req() is used (not pool.request()) so batch.length reflects
        // the true relay-sent count — pool.request() deduplicates against the
        // store, which would cause premature termination when the concurrent
        // live subscription has already added some events.
        let until: number | undefined = undefined;

        while (!cancelled) {
          const filter: Filter = {
            kinds: [REPO_KIND],
            limit: BATCH_LIMIT,
            ...(until !== undefined ? { until } : {}),
          };

          const batch = await lastValueFrom(
            pool
              .req(relays, filter)
              .pipe(completeOnEose(), onlyEvents(), toArray()),
            { defaultValue: [] },
          );

          if (cancelled) break;

          for (const ev of batch) eventStore.add(ev);

          if (batch.length < BATCH_LIMIT) break;

          // Walk backwards: set until to one second before the oldest event
          const oldest = Math.min(...batch.map((e) => e.created_at));
          until = oldest - 1;
        }
      } catch {
        // Fetch failure is non-fatal — show whatever landed in the store
      } finally {
        if (!cancelled) setIsSyncing(false);
      }
    }

    bulkFetch();

    return () => {
      cancelled = true;
    };
  }, [relayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live subscription — keeps the store updated after the bulk fetch
  use$(
    () =>
      pool
        .subscription(relays, [REPO_FILTER])
        .pipe(onlyEvents(), mapEventsToStore(store)),
    [relayKey, store],
  );

  // Reactive read from the store via RepositoryListModel
  const repos = use$(
    () =>
      store.model(RepositoryListModel) as unknown as Observable<ResolvedRepo[]>,
    [store],
  );

  return { repos, isSyncing };
}
