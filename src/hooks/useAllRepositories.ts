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
import { resilientSubscription } from "@/lib/resilientSubscription";
import "window.nostrdb.js";

const REPO_FILTER: Filter = { kinds: [REPO_KIND] };
const BATCH_LIMIT = 500;
// If the cache holds at least this many repo announcements, use negentropy
// (efficient diff sync) instead of a full until-walk.
const NEGENTROPY_THRESHOLD = 1500;
// Max IDs per REQ filter — stay within typical relay limits.
const ID_CHUNK = 500;

export interface UseAllRepositoriesResult {
  repos: ResolvedRepo[] | undefined;
  isSyncing: boolean;
}

/**
 * Fetch ALL repository announcements (kind 30617) from the given relays and
 * return a deduplicated list of resolved repositories.
 *
 * Fetch strategy:
 *   1. Load any cached kind:30617 events from window.nostrdb into the store
 *      immediately so the UI can render while the network sync runs.
 *   2. Count cached events:
 *      - ≥ NEGENTROPY_THRESHOLD (1500): use NIP-77 negentropy sync — the
 *        client already has most events so the diff is small. The need-IDs
 *        are fetched in chunks of ID_CHUNK to stay within relay filter limits.
 *      - < NEGENTROPY_THRESHOLD: use sequential until-walk — cheaper for a
 *        cold start where we need to download everything anyway.
 *   3. A live pool.subscription() keeps the store updated after the bulk sync.
 *
 * persistEventsToCache() in nostr.ts automatically writes every new event
 * added to the store back to window.nostrdb, so the cache grows over time.
 *
 * isSyncing is true from mount until the bulk sync completes (or fails).
 *
 * @param relayOverride - Optional relay URLs to query instead of gitIndexRelays.
 */
export function useAllRepositories(
  relayOverride?: string[],
): UseAllRepositoriesResult {
  const store = useEventStore();
  const [isSyncing, setIsSyncing] = useState(true);

  // Subscribe to gitIndexRelays so the hook re-runs when the user changes
  // their git index relay settings. Falls back to the current value if the
  // observable hasn't emitted yet (it always emits synchronously as a
  // BehaviorSubject, so this is just a type-safety guard).
  const liveGitIndexRelays =
    use$(() => gitIndexRelays, []) ?? gitIndexRelays.getValue();

  // Stable relay list — recompute only when override or gitIndexRelays changes
  const relays = relayOverride ?? liveGitIndexRelays;
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
        // ── Step 1: warm the store from cache ───────────────────────────────
        // Load persisted announcements immediately so the UI can render
        // something useful while the network sync runs in the background.
        const cached = await window.nostrdb.filters([REPO_FILTER]);
        if (cancelled) return;
        for (const ev of cached) eventStore.add(ev);

        // ── Step 2: sync from relay ──────────────────────────────────────────
        if (cached.length >= NEGENTROPY_THRESHOLD) {
          // ── NIP-77 negentropy path ─────────────────────────────────────────
          // The store already has most events; negentropy only transfers the
          // diff. Chunk the need-IDs to stay within relay per-filter limits.
          await pool.negentropy(
            relays,
            eventStore,
            REPO_FILTER,
            async (_have, need) => {
              if (cancelled || need.length === 0) return;
              for (let i = 0; i < need.length; i += ID_CHUNK) {
                if (cancelled) break;
                const chunk = need.slice(i, i + ID_CHUNK);
                const events = await lastValueFrom(
                  pool
                    .req(relays, { ids: chunk } as Filter)
                    .pipe(completeOnEose(), onlyEvents(), toArray()),
                  { defaultValue: [] },
                );
                for (const ev of events) eventStore.add(ev);
              }
            },
            // pool.d.ts types opts as NegentropySyncOptions but the group
            // implementation requires parallel:true — cast to satisfy TS.
            { parallel: true } as object,
          );
        } else {
          // ── Until-walk fallback ────────────────────────────────────────────
          // Cold start or sparse cache: walk backwards fetching 500 events at
          // a time until the relay returns a partial batch.
          // pool.req() (not pool.request()) so batch.length reflects the true
          // relay-sent count — pool.request() deduplicates against the store,
          // which would cause premature termination when the concurrent live
          // subscription has already added some events.
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
        // Sync failure is non-fatal — show whatever landed in the store
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
      resilientSubscription(pool, relays, [REPO_FILTER]).pipe(
        onlyEvents(),
        mapEventsToStore(store),
      ),
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
