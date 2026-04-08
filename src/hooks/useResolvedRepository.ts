import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { includeMailboxes, mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { RelayGroup } from "applesauce-relay";
import type { RelayGroup as RelayGroupType } from "applesauce-relay";
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";
import { pool, liveness } from "@/services/nostr";
import { resilientSubscription } from "@/lib/resilientSubscription";
import { withGapFill } from "@/lib/withGapFill";
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
   *  Always pass to useIssues / usePRs / useNip34ItemLoader. */
  repoRelayGroup: RelayGroupType;
  /** Delta RelayGroup: maintainer outbox + inbox relays that are NOT already
   *  in repoRelayGroup (up to MAX_MAILBOX_RELAYS_PER_USER each, prioritising
   *  connected relays). Empty until NIP-65 resolution completes.
   *  When outbox curation mode is enabled, subscribe to this group IN ADDITION
   *  to repoRelayGroup — do not swap one for the other. */
  extraRelaysForMaintainerMailboxCoverage: RelayGroupType;
}

/**
 * Add relay URLs from an enriched pointer list to a delta RelayGroup, skipping
 * any relay already present in either the delta group or the base group.
 * Prioritises online relays and caps at MAX_MAILBOX_RELAYS_PER_USER per pointer.
 *
 * @param enriched  - Pointers with resolved relay lists
 * @param deltaGroup - The delta group to populate (only receives new relays)
 * @param baseGroup  - The base group whose relays are excluded from the delta
 */
function addMailboxRelaysToGroup(
  enriched: { pubkey: string; relays?: string[] }[],
  deltaGroup: RelayGroupType,
  baseGroup: RelayGroupType,
): void {
  const online = new Set(liveness.online);
  // Exclude relays already in either group so the delta stays truly additive.
  const seen = new Set<string>([
    ...baseGroup.relays.map((r) => r.url),
    ...deltaGroup.relays.map((r) => r.url),
  ]);
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
        if (!deltaGroup.has(r)) deltaGroup.add(r);
      }
      count++;
    }
  }
}

/**
 * Fetch and reactively resolve a single repository by selected maintainer
 * pubkey + d-tag.
 *
 * Layer 1: fetch the selected maintainer's announcement from gitIndexRelays.
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
 *          any not already in repoRelayGroup to extraRelaysForMaintainerMailboxCoverage.
 *          Always runs (not gated on useItemAuthorRelays) so announcement
 *          discovery is always thorough.
 *
 * Returns both groups. Callers always use repoRelayGroup and, when outbox
 * curation mode is enabled, additionally subscribe to
 * extraRelaysForMaintainerMailboxCoverage.
 */
export function useResolvedRepository(
  pubkey: string | undefined,
  dTag: string | undefined,
  relayHints: string[] = [],
): ResolvedRepository | undefined {
  const store = useEventStore();
  const key = `${pubkey}:${dTag}`;
  const hintsKey = relayHints.join(",");

  // Subscribe to gitIndexRelays so Layer 1 re-runs when the user changes
  // their git index relay settings.
  const liveGitIndexRelays =
    use$(() => gitIndexRelays, []) ?? gitIndexRelays.getValue();
  const gitIndexRelayKey = liveGitIndexRelays.join(",");

  // Layer 1: seed the store with the selected maintainer's announcement.
  // Skip the relay query if the event is already in the store cache.
  // Include any URL relay hints so we can find the repo even if it isn't
  // indexed on the default git index relays.
  use$(() => {
    if (!pubkey || !dTag) return undefined;
    if (store.getReplaceable(REPO_KIND, pubkey, dTag)) return undefined;
    const filter: Filter[] = [
      { kinds: [REPO_KIND], authors: [pubkey], "#d": [dTag] } as Filter,
    ];
    const relays = [
      ...liveGitIndexRelays,
      ...relayHints.filter((r) => !liveGitIndexRelays.includes(r)),
    ];
    return resilientSubscription(pool, relays, filter).pipe(
      onlyEvents(),
      mapEventsToStore(store),
    );
  }, [key, hintsKey, gitIndexRelayKey, store]);

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

  // Seed the relay group with URL relay hints immediately so subscriptions
  // can start before the announcement event arrives.
  useMemo(() => {
    if (!repoRelayGroup || relayHints.length === 0) return;
    for (const url of relayHints) {
      const relay = pool.relay(url);
      if (!repoRelayGroup.has(relay)) repoRelayGroup.add(relay);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoRelayGroup, hintsKey]);

  // Delta group: maintainer outbox + inbox relays not already in repoRelayGroup.
  // Stable reference — created once per (pubkey, dTag) pair.
  const extraRelaysForMaintainerMailboxCoverage = useMemo(
    () => (pubkey && dTag ? new RelayGroup([]) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  // Layer 3: once we know the repo's own relay list, add any relays not yet
  // in repoRelayGroup. Also subscribes to maintainer announcements on those relays.
  // If a relay was previously added to extraRelaysForMaintainerMailboxCoverage
  // (Layer 4) and is now declared by the repo itself, remove it from the delta
  // group — repoRelayGroup now covers it and the delta subscription closes cleanly.
  const repoRelayKey = repo?.relays.join(",") ?? "";
  const maintainerKey = repo?.maintainerSet.join(",") ?? "";
  use$(() => {
    if (!dTag || !repo || !repoRelayGroup || repo.relays.length === 0)
      return undefined;

    for (const url of repo.relays) {
      const relay = pool.relay(url);
      if (!repoRelayGroup.has(relay)) repoRelayGroup.add(relay);
      // Evict from the delta group if it was added there before the announcement
      // arrived — repoRelayGroup now provides coverage for this relay.
      if (extraRelaysForMaintainerMailboxCoverage?.has(relay))
        extraRelaysForMaintainerMailboxCoverage.remove(relay);
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
    return withGapFill(
      repoRelayGroup.subscription(filter),
      pool,
      () => repoRelayGroup.relays.map((r) => r.url),
      filter,
    ).pipe(onlyEvents(), mapEventsToStore(store));
  }, [dTag, repoRelayKey, maintainerKey, store, repoRelayGroup]);

  // Layer 4: resolve maintainer outbox + inbox relays. Only relays not already
  // in repoRelayGroup are added to extraRelaysForMaintainerMailboxCoverage.
  // combineLatest fires when either direction resolves, so we don't wait for
  // both before adding the first batch.
  use$(() => {
    if (
      !dTag ||
      !repo ||
      !repoRelayGroup ||
      !extraRelaysForMaintainerMailboxCoverage ||
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
          extraRelaysForMaintainerMailboxCoverage,
          repoRelayGroup,
        );
        addMailboxRelaysToGroup(
          inboxEnriched,
          extraRelaysForMaintainerMailboxCoverage,
          repoRelayGroup,
        );

        if (extraRelaysForMaintainerMailboxCoverage.relays.length === 0)
          return of(null);

        // Subscribe to maintainer announcements on the extra mailbox relays so
        // newly-published announcements arrive in real time.
        const filter: Filter[] = [
          {
            kinds: [REPO_KIND],
            authors: repo.maintainerSet,
            "#d": [dTag],
          } as Filter,
        ];
        return withGapFill(
          extraRelaysForMaintainerMailboxCoverage.subscription(filter),
          pool,
          () =>
            extraRelaysForMaintainerMailboxCoverage.relays.map((r) => r.url),
          filter,
        ).pipe(onlyEvents(), mapEventsToStore(store));
      }),
    ) as unknown as Observable<null>;
  }, [
    dTag,
    maintainerKey,
    store,
    repoRelayGroup,
    extraRelaysForMaintainerMailboxCoverage,
  ]);

  if (!repo || !repoRelayGroup || !extraRelaysForMaintainerMailboxCoverage)
    return undefined;
  return { repo, repoRelayGroup, extraRelaysForMaintainerMailboxCoverage };
}
