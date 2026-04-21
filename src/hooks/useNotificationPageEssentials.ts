/**
 * useNotificationPageEssentials
 *
 * For at most ITEMS_PER_PAGE (10) thread notification items visible on the
 * current page, fetches essentials (status, labels, subject renames) from the
 * repo's declared relays and returns a Map<rootId, ResolvedIssueLite>.
 *
 * Four-part design:
 *
 *   Part A — reactive Map<coord, relayUrls[]> via RepositoryRelayGroup models
 *   Part B — fetch missing repo announcements from git index relays
 *   Part C — trigger nip34ListLoader for each item × relay list
 *   Part D — build Map<rootId, ResolvedIssueLite> from EventStore
 */

import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import {
  combineLatest,
  merge,
  of,
  Observable,
  distinctUntilChanged,
} from "rxjs";
import { map, switchMap, auditTime } from "rxjs/operators";
import { onlyEvents } from "applesauce-relay";
import { mapEventsToStore } from "applesauce-core";
import type { RelayGroup } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";
import type { Filter } from "applesauce-core/helpers";

import { pool, nip34ListLoader } from "@/services/nostr";
import { gitIndexRelays } from "@/services/settings";
import { RepositoryRelayGroup } from "@/models/RepositoryRelayGroup";
import { resolveRepoCoord } from "@/lib/notificationUtils";
import {
  REPO_KIND,
  LABEL_KIND,
  DELETION_KIND,
  STATUS_KINDS,
  PATCH_KIND,
  PR_KIND,
  pubkeyFromCoordinate,
  getRepoMaintainers,
  resolveItemEssentials,
  type ResolvedIssueLite,
} from "@/lib/nip34";
import type {
  ThreadNotificationItem,
  NotificationItem,
} from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split a coord string ("30617:<pubkey>:<dTag>") into { pubkey, dTag }. */
function splitCoord(coord: string): { pubkey: string; dTag: string } | null {
  const parts = coord.split(":");
  if (parts.length < 3) return null;
  const pubkey = parts[1];
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
  const dTag = parts.slice(2).join(":");
  return { pubkey, dTag };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNotificationPageEssentials(
  pageItems: NotificationItem[],
): Map<string, ResolvedIssueLite> | undefined {
  const store = useEventStore();

  // ── Derive thread items ───────────────────────────────────────────────────
  const threadItems = useMemo(
    () =>
      pageItems.filter(
        (item): item is ThreadNotificationItem => item.kind === "thread",
      ),
    [pageItems],
  );

  const rootIds = useMemo(
    () => threadItems.map((item) => item.rootId),
    [threadItems],
  );

  // Stable dep key — changes only when the set of root IDs changes.
  const rootIdsKey = useMemo(() => [...rootIds].sort().join(","), [rootIds]);

  // ── Part A: reactive Map<coord, relayUrls[]> ─────────────────────────────
  //
  // A single use$ that:
  //  1. Subscribes to root events in the store so coords derived from root
  //     event #a tags (not always present in item.events) are picked up.
  //  2. Merges with static coords already extractable from item.events.
  //  3. For each unique coord, subscribes to RepositoryRelayGroup (cached by
  //     the EventStore model system) to get a reactive relay URL list.
  //  4. combineLatest → Map<coord, string[]> that updates whenever any relay
  //     group emits (i.e. when new relay URLs are discovered).
  const relayMap = use$(() => {
    if (rootIds.length === 0) return of(new Map<string, string[]>());

    // Pre-compute static coords from item.events (synchronous, no store access).
    const staticCoords = new Map<string, string>(); // rootId → coord
    for (const item of threadItems) {
      const coord = resolveRepoCoord(undefined, item);
      if (coord) staticCoords.set(item.rootId, coord);
    }

    return store.timeline([{ ids: rootIds } as Filter]).pipe(
      map((rootEventsRaw) => {
        // Start with static coords, supplement from root events now in store.
        const coordByRootId = new Map(staticCoords);
        for (const ev of rootEventsRaw as NostrEvent[]) {
          if (!coordByRootId.has(ev.id)) {
            const aTag = ev.tags.find(([t]) => t === "a")?.[1];
            if (aTag?.startsWith("30617:")) coordByRootId.set(ev.id, aTag);
          }
        }
        return coordByRootId;
      }),

      // Only tear down and rebuild relay group subscriptions when the coord
      // set actually changes — don't react to every store event.
      distinctUntilChanged((a, b) => {
        if (a.size !== b.size) return false;
        for (const [k, v] of a) {
          if (b.get(k) !== v) return false;
        }
        return true;
      }),

      switchMap((coordByRootId) => {
        const uniqueCoords = [...new Set(coordByRootId.values())];
        if (uniqueCoords.length === 0) return of(new Map<string, string[]>());

        // For each unique coord, subscribe to RepositoryRelayGroup.
        // The model is cached by the EventStore — all components on the page
        // share one live instance.
        const coordRelayObs = uniqueCoords.flatMap((coord) => {
          const parsed = splitCoord(coord);
          if (!parsed) return [];
          const { pubkey, dTag } = parsed;

          // RepositoryRelayGroup emits the same RelayGroup instance every
          // time a relay is added to it, so a simple map() is sufficient.
          return [
            (
              store.model(
                RepositoryRelayGroup,
                pubkey,
                dTag,
              ) as unknown as Observable<RelayGroup>
            ).pipe(
              map(
                (group) =>
                  [coord, group.relays.map((r) => r.url)] as [string, string[]],
              ),
            ),
          ];
        });

        if (coordRelayObs.length === 0) return of(new Map<string, string[]>());
        return combineLatest(coordRelayObs).pipe(
          map((entries) => new Map(entries)),
        );
      }),
    ) as unknown as Observable<Map<string, string[]>>;
  }, [rootIdsKey, store]);

  // ── Stable key for Part B: coord list ────────────────────────────────────
  // Derived from relayMap keys so Part B re-runs when new coords are
  // discovered (e.g. a root event arriving in the store reveals a coord that
  // wasn't available from item.events).
  const coordsKey = useMemo(() => {
    if (!relayMap) return rootIdsKey;
    return [...relayMap.keys()].sort().join(",");
  }, [relayMap, rootIdsKey]);

  const uniqueCoords = useMemo(
    () => (relayMap ? [...relayMap.keys()] : []),
    [relayMap],
  );

  // ── Part B: fetch missing repo announcements ──────────────────────────────
  //
  // Keyed on the coord list only (not relay changes).
  // For each coord whose kind:30617 is absent from the store, fires a
  // pool.subscription against gitIndexRelays so the announcement arrives and
  // RepositoryRelayGroup (which watches store.addressable) can build the relay
  // list from it.
  use$(() => {
    if (uniqueCoords.length === 0) return undefined;

    const missingFetches: Observable<NostrEvent>[] = [];
    for (const coord of uniqueCoords) {
      const parsed = splitCoord(coord);
      if (!parsed) continue;
      const { pubkey, dTag } = parsed;

      const existing = store.getByFilters([
        {
          kinds: [REPO_KIND],
          authors: [pubkey],
          "#d": [dTag],
          limit: 1,
        } as Filter,
      ]) as NostrEvent[];
      if (existing.length > 0) continue;

      missingFetches.push(
        pool
          .subscription(gitIndexRelays.getValue(), [
            { kinds: [REPO_KIND], authors: [pubkey], "#d": [dTag] } as Filter,
          ])
          .pipe(
            onlyEvents(),
            mapEventsToStore(store),
          ) as unknown as Observable<NostrEvent>,
      );
    }

    if (missingFetches.length === 0) return undefined;
    return merge(...missingFetches);
  }, [coordsKey, store]);

  // ── Stable key for Part C: relay map contents ────────────────────────────
  // Changes only when the actual relay URLs change, not on every Map reference
  // change. When new relays are discovered, relayMapKey changes and Part C
  // re-runs with the full updated relay list. nip34ListLoader's cacheRequest
  // ensures each relay is only queried once per filter.
  const relayMapKey = useMemo(() => {
    if (!relayMap) return "";
    return [...relayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([coord, relays]) => `${coord}:${[...relays].sort().join(",")}`)
      .join("|");
  }, [relayMap]);

  // ── Part C: trigger essentials loading ────────────────────────────────────
  //
  // Fires nip34ListLoader(itemId, relays) for each thread item that has a
  // coord with known relays. Re-runs when the relay map grows.
  use$(() => {
    if (threadItems.length === 0 || !relayMap || relayMap.size === 0)
      return undefined;

    const loaders: Observable<unknown>[] = [];

    for (const item of threadItems) {
      // Derive coord: static from item.events first, then store snapshot.
      let coord = resolveRepoCoord(undefined, item);
      if (!coord) {
        const rootEvs = store.getByFilters([
          { ids: [item.rootId] },
        ]) as NostrEvent[];
        const aTag = rootEvs[0]?.tags.find(([t]) => t === "a")?.[1];
        if (aTag?.startsWith("30617:")) coord = aTag;
      }

      if (!coord) continue;
      const relays = relayMap.get(coord);
      if (!relays || relays.length === 0) continue;

      loaders.push(nip34ListLoader(item.rootId, relays));
    }

    if (loaders.length === 0) return undefined;
    return merge(...loaders);
  }, [rootIdsKey, relayMapKey, store]);

  // ── Part D: build Map<rootId, ResolvedIssueLite> from EventStore ──────────
  //
  // Mirrors IssueListModel's combineLatest + auditTime(100) pattern.
  // Reacts to root events and essentials (status, labels, deletions) arriving
  // in the store.
  const resolvedMap = use$(() => {
    if (rootIds.length === 0) return of(new Map<string, ResolvedIssueLite>());

    return combineLatest([
      store.timeline([{ ids: rootIds } as Filter]),
      store.timeline([
        {
          kinds: [...STATUS_KINDS, LABEL_KIND, DELETION_KIND],
          "#e": rootIds,
        } as Filter,
      ]),
    ]).pipe(
      auditTime(100),
      map(([rootEventsRaw, essentialsRaw]) => {
        const rootEvents = rootEventsRaw as NostrEvent[];
        const essentials = essentialsRaw as NostrEvent[];
        const result = new Map<string, ResolvedIssueLite>();

        for (const rootEvent of rootEvents) {
          // Build the maintainer set from the coord's pubkey + the repo
          // announcement's maintainers list (if the announcement is in store).
          const coord = rootEvent.tags.find(([t]) => t === "a")?.[1];
          const maintainerSet = new Set<string>();

          if (coord?.startsWith("30617:")) {
            const pk = pubkeyFromCoordinate(coord);
            if (pk) maintainerSet.add(pk);

            const parsed = splitCoord(coord);
            if (parsed) {
              const ann = store.getByFilters([
                {
                  kinds: [REPO_KIND],
                  authors: [parsed.pubkey],
                  "#d": [parsed.dTag],
                  limit: 1,
                } as Filter,
              ]) as NostrEvent[];
              if (ann.length > 0) {
                for (const mp of getRepoMaintainers(ann[0])) {
                  maintainerSet.add(mp);
                }
              }
            }
          }

          // Filter essentials to those referencing this root via #e tag.
          // resolveItemEssentials will re-filter internally using NIP-10;
          // this pre-filter just avoids passing the full essentials array.
          const itemEssentials = essentials.filter((ev) =>
            ev.tags.some(([t, id]) => t === "e" && id === rootEvent.id),
          );

          const resolved = resolveItemEssentials(
            rootEvent,
            itemEssentials,
            [], // comments — not needed for notification display
            [], // zaps — not needed for notification display
            maintainerSet,
            {
              mergeStatusRequiresMaintainer:
                rootEvent.kind === PATCH_KIND || rootEvent.kind === PR_KIND,
            },
          );

          result.set(rootEvent.id, resolved);
        }

        return result;
      }),
    ) as unknown as Observable<Map<string, ResolvedIssueLite>>;
  }, [rootIdsKey, store]);

  return resolvedMap;
}
