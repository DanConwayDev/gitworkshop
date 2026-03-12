import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { includeMailboxes, mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { RelayGroup } from "applesauce-relay";
import type { RelayGroup as RelayGroupType } from "applesauce-relay";
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";
import { pool, liveness } from "@/services/nostr";
import { REPO_KIND, type ResolvedRepo } from "@/lib/nip34";
import { gitIndexRelays } from "@/services/settings";
import { RepositoryModel } from "@/models/RepositoryModel";
import { RepositoryRelayGroup } from "@/models/RepositoryRelayGroup";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";
import { combineLatest, of } from "rxjs";
import { switchMap } from "rxjs/operators";

/** Max healthy mailbox relays to take per maintainer when querying NIP-65 relays. */
const MAX_MAILBOX_RELAYS_PER_USER = 3;

export interface ResolvedRepository {
  repo: ResolvedRepo;
  /** Base RelayGroup: repo-declared relays + relay hints only.
   *  Pass to useIssues / useNip34Loaders when nip65 is disabled. */
  repoRelayGroup: RelayGroupType;
  /** Extended RelayGroup: repoRelayGroup + maintainer outbox + maintainer inbox
   *  relays (up to MAX_MAILBOX_RELAYS_PER_USER each, prioritising connected).
   *  Always used for announcement discovery. Pass to useIssues /
   *  useNip34Loaders when nip65 is enabled. */
  repoRelayAndMaintainerMailboxGroup: RelayGroupType;
}

/**
 * Add relay URLs from an enriched pointer list to a RelayGroup, skipping any
 * already present. Prioritises online relays and caps at
 * MAX_MAILBOX_RELAYS_PER_USER per pointer.
 */
function addMailboxRelaysToGroup(
  enriched: { pubkey: string; relays?: string[] }[],
  group: RelayGroupType,
): void {
  const online = new Set(liveness.online);
  const seen = new Set<string>(group.relays.map((r) => r.url));
  for (const pointer of enriched) {
    const relays = (pointer.relays ?? [])
      .slice()
      .sort((a, b) => (online.has(a) ? 0 : 1) - (online.has(b) ? 0 : 1));
    let count = 0;
    for (const relay of relays) {
      if (count >= MAX_MAILBOX_RELAYS_PER_USER) break;
      if (!seen.has(relay)) {
        seen.add(relay);
        const r = pool.relay(relay);
        if (!group.has(r)) group.add(r);
      }
      count++;
    }
  }
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
 *          relays for ALL maintainer announcements. Adds relays to both groups.
 *
 * Layer 4: resolve each maintainer's NIP-65 outbox AND inbox relays and add
 *          them to repoRelayAndMaintainerMailboxGroup only — repoRelayGroup
 *          stays as the pure base. Always runs (not gated on nip65) so
 *          announcement discovery is always thorough.
 *
 * Returns both groups so callers choose the right one:
 *   - nip65 disabled → repoRelayGroup
 *   - nip65 enabled  → repoRelayAndMaintainerMailboxGroup
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

  // Base RelayGroup: repo-declared relays + relay hints only.
  // Backed by the RepositoryRelayGroup model so it's cached and shared.
  const repoRelayGroup = use$(() => {
    if (!pubkey || !dTag) return undefined;
    return store.model(
      RepositoryRelayGroup,
      pubkey,
      dTag,
    ) as unknown as Observable<RelayGroupType>;
  }, [key, store]);

  // Extended group: base + maintainer outbox + inbox relays.
  // Stable reference — created once per (pubkey, dTag) pair.
  const repoRelayAndMaintainerMailboxGroup = useMemo(
    () => (pubkey && dTag ? new RelayGroup([]) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  // Layer 3: once we know the repo's own relay list, add any relays not yet
  // in either group. Also subscribes to maintainer announcements on those relays.
  const repoRelayKey = repo?.relays.join(",") ?? "";
  const maintainerKey = repo?.maintainerSet.join(",") ?? "";
  use$(() => {
    if (
      !dTag ||
      !repo ||
      !repoRelayGroup ||
      !repoRelayAndMaintainerMailboxGroup ||
      repo.relays.length === 0
    )
      return undefined;

    for (const url of repo.relays) {
      const relay = pool.relay(url);
      if (!repoRelayGroup.has(relay)) repoRelayGroup.add(relay);
      if (!repoRelayAndMaintainerMailboxGroup.has(relay))
        repoRelayAndMaintainerMailboxGroup.add(relay);
    }

    // Subscribe to all maintainer announcements on the repo's relays so
    // newly-published announcements arrive in real time.
    const filter: Filter[] = [
      {
        kinds: [REPO_KIND],
        authors: repo.maintainerSet,
        "#d": [dTag],
      } as Filter,
    ];
    return repoRelayGroup
      .subscription(filter)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [
    dTag,
    repoRelayKey,
    maintainerKey,
    store,
    repoRelayGroup,
    repoRelayAndMaintainerMailboxGroup,
  ]);

  // Layer 4: resolve maintainer outbox + inbox relays and add them to the
  // mailbox group only. repoRelayGroup is left as the pure base.
  // combineLatest fires when either direction resolves, so we don't wait for
  // both before adding the first batch.
  use$(() => {
    if (
      !dTag ||
      !repo ||
      !repoRelayAndMaintainerMailboxGroup ||
      repo.maintainerSet.length === 0
    )
      return undefined;

    const pointers = repo.maintainerSet.map((pk) => ({ pubkey: pk }));
    const outbox$ = of(pointers).pipe(
      includeMailboxes(store, "outbox"),
      ignoreUnhealthyRelaysOnPointers(liveness),
    );
    const inbox$ = of(pointers).pipe(
      includeMailboxes(store, "inbox"),
      ignoreUnhealthyRelaysOnPointers(liveness),
    );

    return combineLatest([outbox$, inbox$]).pipe(
      switchMap(([outboxEnriched, inboxEnriched]) => {
        addMailboxRelaysToGroup(
          outboxEnriched,
          repoRelayAndMaintainerMailboxGroup,
        );
        addMailboxRelaysToGroup(
          inboxEnriched,
          repoRelayAndMaintainerMailboxGroup,
        );

        if (repoRelayAndMaintainerMailboxGroup.relays.length === 0)
          return of(null);

        // Subscribe to maintainer announcements on all mailbox relays so
        // newly-published announcements arrive in real time.
        const filter: Filter[] = [
          {
            kinds: [REPO_KIND],
            authors: repo.maintainerSet,
            "#d": [dTag],
          } as Filter,
        ];
        return repoRelayAndMaintainerMailboxGroup
          .subscription(filter)
          .pipe(onlyEvents(), mapEventsToStore(store));
      }),
    ) as unknown as Observable<null>;
  }, [dTag, maintainerKey, store, repoRelayAndMaintainerMailboxGroup]);

  if (!repo || !repoRelayGroup || !repoRelayAndMaintainerMailboxGroup)
    return undefined;
  return { repo, repoRelayGroup, repoRelayAndMaintainerMailboxGroup };
}
