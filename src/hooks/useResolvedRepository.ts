import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { includeMailboxes, mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import type { RelayGroup } from "applesauce-relay";
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";
import { pool, liveness } from "@/services/nostr";

/** Max healthy mailbox relays to take per maintainer when querying NIP-65 relays. */
const MAX_MAILBOX_RELAYS_PER_USER = 3;
import { REPO_KIND, type ResolvedRepo } from "@/lib/nip34";
import { gitIndexRelays } from "@/services/settings";
import { RepositoryModel } from "@/models/RepositoryModel";
import { RepositoryRelayGroup } from "@/models/RepositoryRelayGroup";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";
import { of } from "rxjs";
import { switchMap } from "rxjs/operators";

export interface ResolvedRepository {
  repo: ResolvedRepo;
  /** Long-lived RelayGroup for this repository. Grows as relay discovery
   *  progresses — new relays are added without tearing down existing
   *  subscriptions. Pass this to useIssues, useNip34Loaders, etc. */
  group: RelayGroup;
}

/**
 * Fetch and reactively resolve a single repository by selected maintainer
 * pubkey + d-tag.
 *
 * Layer 1: fetch the selected maintainer's announcement from NGIT_RELAYS.
 *          Skips the relay query if the announcement is already in the store,
 *          proceeding directly to Layer 2.
 *
 * Layer 2: RepositoryModel — reactive BFS chain resolution. Emits a new
 *          ResolvedRepo whenever any announcement in the chain changes.
 *          Cached by the store — multiple components on the same page share
 *          one model instance.
 *
 * Layer 3: once the ResolvedRepo is known, re-query the repo's own declared
 *          relays for ALL maintainer announcements. Uses group.add() to extend
 *          the shared RelayGroup rather than opening a new subscription.
 *
 * Layer 4: query each maintainer's NIP-65 outbox relays for their
 *          announcement. Again uses group.add() for newly-discovered relays.
 *
 * Returns both the resolved repo and the shared RelayGroup so callers can
 * pass the group directly to useIssues, useNip34Loaders, etc.
 */
export function useResolvedRepository(
  pubkey: string | undefined,
  dTag: string | undefined,
): ResolvedRepository | undefined {
  const store = useEventStore();
  const key = `${pubkey}:${dTag}`;

  // Layer 1: seed the store with the selected maintainer's announcement.
  // Skip the relay query if the event is already in the store cache.
  use$(() => {
    if (!pubkey || !dTag) return undefined;
    if (store.getReplaceable(REPO_KIND, pubkey, dTag)) return undefined;
    const filter: Filter[] = [
      { kinds: [REPO_KIND], authors: [pubkey], "#d": [dTag] } as Filter,
    ];
    return pool
      .subscription(gitIndexRelays.getValue(), filter)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [key, store]);

  // Layer 2: subscribe to the model.
  const repo = use$(() => {
    if (!pubkey || !dTag) return undefined;
    return store.model(RepositoryModel, pubkey, dTag) as unknown as Observable<
      ResolvedRepo | undefined
    >;
  }, [key, store]);

  // Subscribe to the relay group model — same cache key as RepositoryModel.
  // Emits the same RelayGroup instance every time a relay is added to it.
  const group = use$(() => {
    if (!pubkey || !dTag) return undefined;
    return store.model(
      RepositoryRelayGroup,
      pubkey,
      dTag,
    ) as unknown as Observable<RelayGroup>;
  }, [key, store]);

  // Layer 3: once we know the repo's own relay list, add any relays not yet
  // in the group. group.add() is idempotent — already-present relays are
  // skipped. The subscription on the group itself (opened by useIssues etc.)
  // picks up the new relay automatically via reverseSwitchMap + WeakMap cache.
  const repoRelayKey = repo?.relays.join(",") ?? "";
  const maintainerKey = repo?.maintainerSet.join(",") ?? "";
  use$(() => {
    if (!dTag || !repo || !group || repo.relays.length === 0) return undefined;

    // Add repo-declared relays to the group
    for (const url of repo.relays) {
      const relay = pool.relay(url);
      if (!group.has(relay)) group.add(relay);
    }

    // Also subscribe to all maintainer announcements on the repo's relays
    // so newly-published announcements arrive in real time.
    const filter: Filter[] = [
      {
        kinds: [REPO_KIND],
        authors: repo.maintainerSet,
        "#d": [dTag],
      } as Filter,
    ];
    return group
      .subscription(filter)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [dTag, repoRelayKey, maintainerKey, store, group]);

  // Layer 4: query each maintainer's NIP-65 outbox relays for their
  // announcement. Add newly-discovered outbox relays to the group.
  use$(() => {
    if (!dTag || !repo || !group || repo.maintainerSet.length === 0)
      return undefined;
    const pointers = repo.maintainerSet.map((pk) => ({ pubkey: pk }));
    return of(pointers).pipe(
      includeMailboxes(store),
      ignoreUnhealthyRelaysOnPointers(liveness),
      switchMap((enriched) => {
        const online = new Set(liveness.online);
        // Skip relays already in the group
        const seen = new Set<string>(group.relays.map((r) => r.url));
        const outboxRelays: string[] = [];
        for (const pointer of enriched) {
          const relays = (pointer.relays ?? [])
            .slice()
            .sort((a, b) => (online.has(a) ? 0 : 1) - (online.has(b) ? 0 : 1));
          let count = 0;
          for (const relay of relays) {
            if (count >= MAX_MAILBOX_RELAYS_PER_USER) break;
            if (!seen.has(relay)) {
              seen.add(relay);
              outboxRelays.push(relay);
            }
            count++;
          }
        }

        // Add new outbox relays to the group — existing subscriptions untouched
        for (const url of outboxRelays) {
          const relay = pool.relay(url);
          if (!group.has(relay)) group.add(relay);
        }

        if (outboxRelays.length === 0) return of(null);

        // Subscribe to maintainer announcements on the newly-added relays.
        // group.subscription() will pick up the new relays via reverseSwitchMap.
        const filter: Filter[] = [
          {
            kinds: [REPO_KIND],
            authors: repo.maintainerSet,
            "#d": [dTag],
          } as Filter,
        ];
        return group
          .subscription(filter)
          .pipe(onlyEvents(), mapEventsToStore(store));
      }),
    ) as unknown as Observable<null>;
  }, [dTag, maintainerKey, store, group]);

  if (!repo || !group) return undefined;
  return { repo, group };
}
