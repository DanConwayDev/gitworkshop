import { useEffect, useRef, useState } from "react";
import { lastValueFrom, toArray } from "rxjs";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents, SyncDirection, completeOnEose } from "applesauce-relay";
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
 * Fetch strategy (per relay):
 *   1. Check relay NIP support (relay info document, already fetched on connect).
 *   2. NIP-77 supported → pool.sync(..., "down") — efficient diff-based bulk
 *      download; handles the relay's per-request limit transparently.
 *   3. NIP-77 not supported → sequential until-walk: repeatedly call
 *      relay.request({ kinds:[30617], limit:500, until }) until a batch
 *      returns fewer than BATCH_LIMIT events, then stop.
 *   4. After the initial bulk fetch completes, open a live pool.subscription()
 *      so newly published repos appear in real time.
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
        // Check NIP-77 support on the first relay in the list.
        // We use a single relay for the bulk fetch (the index relay is always
        // one URL); for multi-relay overrides we fall back to pagination.
        const firstRelay = pool.relay(relays[0]);

        // Wait briefly for the relay info document to arrive (it's fetched
        // automatically on first connection). 2 s is generous.
        const supportedNips = await new Promise<number[]>((resolve) => {
          let resolved = false;
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve([]);
            }
          }, 2000);
          firstRelay.supported$.subscribe((nips) => {
            if (nips !== undefined && !resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(nips ?? []);
            }
          });
        });

        if (cancelled) return;

        if (supportedNips.includes(77)) {
          // ── NIP-77 path ──────────────────────────────────────────────────
          await lastValueFrom(
            pool
              .sync(relays, eventStore, REPO_FILTER, SyncDirection.RECEIVE)
              .pipe(mapEventsToStore(eventStore)),
            { defaultValue: null },
          );
        } else {
          // ── Fallback: sequential until-walk ─────────────────────────────
          // Use pool.req() (no deduplication) so batch.length reflects the
          // true number of events the relay sent. pool.request() deduplicates
          // against the store, so events already added by the concurrent live
          // pool.subscription() would shrink batches and cause the walk to
          // terminate prematurely before all events are fetched.
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
        }
      } catch {
        // Sync failure is non-fatal — we show whatever landed in the store
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
