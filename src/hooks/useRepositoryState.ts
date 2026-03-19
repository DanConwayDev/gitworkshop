import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { onlyEvents } from "applesauce-relay";
import { mapEventsToStore } from "applesauce-core";
import { pool } from "@/services/nostr";
import { REPO_STATE_KIND } from "@/lib/nip34";
import {
  RepositoryState,
  isValidRepositoryState,
} from "@/casts/RepositoryState";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";
import { map, filter, startWith } from "rxjs/operators";
import type { RelayGroup } from "applesauce-relay";

/**
 * Pick the winning state event from a list of candidates.
 *
 * NIP-34 says the latest `created_at` wins; event ID is the tiebreaker
 * (lexicographically larger ID wins) so the result is deterministic.
 */
function pickWinningStateEvent(
  events: { id: string; created_at: number; pubkey: string }[],
): { id: string; created_at: number; pubkey: string } | undefined {
  if (events.length === 0) return undefined;
  return events.reduce((best, ev) => {
    if (ev.created_at > best.created_at) return ev;
    if (ev.created_at === best.created_at && ev.id > best.id) return ev;
    return best;
  });
}

/**
 * Fetch and reactively subscribe to the winning kind:30618 repository state
 * event for a repository.
 *
 * The "winner" is the state event with the latest `created_at` among all
 * maintainers, with the event ID as a tiebreaker (lexicographically larger
 * ID wins). This matches the NIP-34 spec.
 *
 * Returns a tuple of:
 *   - The winning `RepositoryState` cast, `null` when none exists, or
 *     `undefined` while the initial Nostr query is still in flight.
 *   - `repoRelayEose`: `true` once the repo relay group has sent EOSE for the
 *     state query (all relays responded or timed out — max 10 s per relay),
 *     `false` while pending. Always `true` when `repoRelayGroup` is undefined.
 *
 * @param dTag           - The repository d-tag identifier
 * @param maintainerSet  - All maintainer pubkeys (from ResolvedRepo.maintainerSet)
 * @param repoRelayGroup - The relay group to query (from useResolvedRepository)
 */
export function useRepositoryState(
  dTag: string | undefined,
  maintainerSet: string[] | undefined,
  repoRelayGroup: RelayGroup | undefined,
): [RepositoryState | null | undefined, boolean] {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  const maintainerKey = maintainerSet?.join(",") ?? "";
  const relayKey = repoRelayGroup?.relays.map((r) => r.url).join(",") ?? "";

  // Fetch state events from the repo relay group for all maintainers and pipe
  // them into the EventStore. kind:30618 is addressable — one per pubkey+d-tag.
  use$(() => {
    if (
      !dTag ||
      !maintainerSet ||
      maintainerSet.length === 0 ||
      !repoRelayGroup
    )
      return undefined;

    const stateFilter: Filter = {
      kinds: [REPO_STATE_KIND],
      authors: maintainerSet,
      "#d": [dTag],
    } as Filter;

    return repoRelayGroup
      .subscription([stateFilter])
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [dTag, maintainerKey, relayKey, store]);

  // Track whether the repo relay group has sent EOSE for the state query.
  // The relay group emits "EOSE" once all relays have responded (or timed out /
  // errored — each relay has a 10 s synthetic EOSE fallback). Starts false,
  // flips to true on the first "EOSE" message from the group.
  // When repoRelayGroup is undefined there is nothing to wait for → default true.
  const repoRelayEose =
    use$((): Observable<boolean> | undefined => {
      if (
        !dTag ||
        !maintainerSet ||
        maintainerSet.length === 0 ||
        !repoRelayGroup
      )
        return undefined;

      const stateFilter: Filter = {
        kinds: [REPO_STATE_KIND],
        authors: maintainerSet,
        "#d": [dTag],
      } as Filter;

      // applesauce RelayGroup.subscription() multicasts internally via share(),
      // so this second subscription reuses the same underlying WebSocket REQ.
      return repoRelayGroup.subscription([stateFilter]).pipe(
        filter((msg): msg is "EOSE" => msg === "EOSE"),
        map(() => true as boolean),
        startWith(false),
      );
    }, [dTag, maintainerKey, relayKey, store]) ?? repoRelayGroup === undefined;

  // Also query git index relays in case the repo relays don't have the state events.
  use$(() => {
    if (!dTag || !maintainerSet || maintainerSet.length === 0) return undefined;

    const indexFilter: Filter = {
      kinds: [REPO_STATE_KIND],
      authors: maintainerSet,
      "#d": [dTag],
    } as Filter;

    return pool
      .subscription(["wss://relay.ngit.dev"], [indexFilter])
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [dTag, maintainerKey, store]);

  // Read back from the store and pick the winner.
  // store.getReplaceable returns the latest event per pubkey+kind+d-tag,
  // so we collect one per maintainer and apply the tiebreaker ourselves.
  const repoState = use$(() => {
    if (!dTag || !maintainerSet || maintainerSet.length === 0) return undefined;

    // Subscribe to the timeline for all maintainer state events so we react
    // to new arrivals.
    const storeFilter: Filter = {
      kinds: [REPO_STATE_KIND],
      authors: maintainerSet,
      "#d": [dTag],
    } as Filter;

    return store.timeline([storeFilter]).pipe(
      map((events) => {
        const valid = events.filter(isValidRepositoryState);
        if (valid.length === 0) return null;
        const winner = pickWinningStateEvent(valid);
        if (!winner) return null;
        const winnerEvent = valid.find((e) => e.id === winner.id);
        if (!winnerEvent) return null;
        try {
          return new RepositoryState(winnerEvent, castStore);
        } catch {
          return null;
        }
      }),
    ) as unknown as Observable<RepositoryState | null>;
  }, [dTag, maintainerKey, store]);

  return [repoState, repoRelayEose];
}
