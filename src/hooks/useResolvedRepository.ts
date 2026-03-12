import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { includeMailboxes, mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";
import { pool, liveness } from "@/services/nostr";

/** Max healthy mailbox relays to take per maintainer when querying NIP-65 relays. */
const MAX_MAILBOX_RELAYS_PER_USER = 3;
import { REPO_KIND, NGIT_RELAYS, type ResolvedRepo } from "@/lib/nip34";
import { RepositoryModel } from "@/models/RepositoryModel";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";
import { of } from "rxjs";
import { switchMap } from "rxjs/operators";

/**
 * Fetch and reactively resolve a single repository by selected maintainer
 * pubkey + d-tag.
 *
 * Layer 1: fetch the selected maintainer's announcement from NGIT_RELAYS.
 *
 * Layer 2: RepositoryModel — reactive BFS chain resolution. Emits a new
 *          ResolvedRepo whenever any announcement in the chain changes.
 *          Cached by the store — multiple components on the same page share
 *          one model instance.
 *
 * Layer 3: once the ResolvedRepo is known, re-query the repo's own declared
 *          relays for ALL maintainer announcements. This ensures co-maintainer
 *          announcements that only exist on repo-specific relays (not on
 *          NGIT_RELAYS) are discovered and the chain fully resolves.
 *          Re-runs whenever the relay list or maintainer set grows.
 */
export function useResolvedRepository(
  pubkey: string | undefined,
  dTag: string | undefined,
): ResolvedRepo | undefined {
  const store = useEventStore();
  const key = `${pubkey}:${dTag}`;

  // Layer 1: seed the store with the selected maintainer's announcement.
  use$(() => {
    if (!pubkey || !dTag) return undefined;
    const filter: Filter[] = [
      { kinds: [REPO_KIND], authors: [pubkey], "#d": [dTag] } as Filter,
    ];
    return pool
      .subscription(NGIT_RELAYS, filter)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [key, store]);

  // Layer 2: subscribe to the model.
  const repo = use$(() => {
    if (!pubkey || !dTag) return undefined;
    return store.model(RepositoryModel, pubkey, dTag) as unknown as Observable<
      ResolvedRepo | undefined
    >;
  }, [key, store]);

  // Layer 3: once we know the repo's own relay list, query those relays for
  // all maintainer announcements. The dep key includes both the relay list and
  // the maintainer set so this re-fires whenever either grows (e.g. a newly
  // discovered maintainer lists yet another relay).
  const repoRelayKey = repo?.relays.join(",") ?? "";
  const maintainerKey = repo?.maintainerSet.join(",") ?? "";
  use$(() => {
    if (!dTag || !repo || repo.relays.length === 0) return undefined;
    const filter: Filter[] = [
      {
        kinds: [REPO_KIND],
        authors: repo.maintainerSet,
        "#d": [dTag],
      } as Filter,
    ];
    return pool
      .subscription(repo.relays, filter)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [dTag, repoRelayKey, maintainerKey, store]);

  // Layer 4: query each maintainer's NIP-65 outbox relays for their
  // announcement. Kind:10002 events are fetched via the indexer relays
  // configured in lookupRelays (purplepag.es, index.hzrd149.com, etc.) by
  // the eventStore.eventLoader — no manual relay hints needed.
  //
  // This catches announcements that only exist on a maintainer's personal
  // outbox relays and were never published to NGIT_RELAYS or the repo's
  // declared relay list.
  use$(() => {
    if (!dTag || !repo || repo.maintainerSet.length === 0) return undefined;
    const pointers = repo.maintainerSet.map((pk) => ({ pubkey: pk }));
    return of(pointers).pipe(
      // Enrich each pointer with the maintainer's outbox relays.
      // includeMailboxes fetches kind:10002 via eventStore.eventLoader which
      // uses the configured lookupRelays (indexer relays).
      includeMailboxes(store),
      // Filter dead/backoff relays before connecting. Repo-declared relays and
      // relay hints are not passed through here — only NIP-65 outbox relays.
      ignoreUnhealthyRelaysOnPointers(liveness),
      switchMap((enriched) => {
        // Collect outbox relay URLs, deduplicated, capped per maintainer.
        // Liveness filtering has already run so remaining relays are healthy.
        // Already-connected relays are sorted first so we reuse open
        // connections before opening new ones.
        const online = new Set(liveness.online);
        const seen = new Set<string>([...repo.relays]); // skip already-queried relays
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
        if (outboxRelays.length === 0) return of(null);
        const filter: Filter[] = [
          {
            kinds: [REPO_KIND],
            authors: repo.maintainerSet,
            "#d": [dTag],
          } as Filter,
        ];
        return pool
          .subscription(outboxRelays, filter)
          .pipe(onlyEvents(), mapEventsToStore(store));
      }),
    ) as unknown as Observable<null>;
  }, [dTag, maintainerKey, store]);

  return repo;
}
