import { useState, useEffect } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { REPO_STATE_KIND } from "@/lib/nip34";
import {
  RepositoryState,
  isValidRepositoryState,
} from "@/casts/RepositoryState";
import { loadRepoStateFromRelays } from "@/lib/repoStateLoader";
import { pool } from "@/services/nostr";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import type { Filter } from "applesauce-core/helpers";
import { getSeenRelays } from "applesauce-core/helpers";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";
import type { RelayGroup } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";

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
 * event for a repository, while also tracking the per-relay state registry.
 *
 * The "winner" is the state event with the latest `created_at` among all
 * maintainers, with the event ID as a tiebreaker (lexicographically larger
 * ID wins). This matches the NIP-34 spec.
 *
 * Each relay in the group is queried individually so that every relay's
 * version of the addressable event is observed. The loader stamps each event
 * with its source relay via markFromRelay() before writing it to the
 * EventStore, so getSeenRelays(event) is available on any stored event.
 *
 * Returns a tuple of:
 *   - The winning `RepositoryState` cast, `null` when none exists, or
 *     `undefined` while the initial Nostr query is still in flight.
 *   - `repoRelayEose`: `true` once all relays in the group have settled
 *     (debounced by 200ms after the last relay responds), `false` while
 *     pending. Always `true` when `repoRelayGroup` is undefined.
 *   - `relayStateMap`: `Map<relayUrl, NostrEvent>` — the best state event
 *     seen from each relay, derived reactively from the EventStore via
 *     getSeenRelays(). Callers can use this to determine whether a Grasp
 *     server is behind the canonical state and what commit it last announced.
 *
 * @param dTag           - The repository d-tag identifier
 * @param maintainerSet  - All maintainer pubkeys (from ResolvedRepo.maintainerSet)
 * @param repoRelayGroup - The relay group to query (from useResolvedRepository)
 */
export function useRepositoryState(
  dTag: string | undefined,
  maintainerSet: string[] | undefined,
  repoRelayGroup: RelayGroup | undefined,
): [RepositoryState | null | undefined, boolean, Map<string, NostrEvent>] {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  const maintainerKey = maintainerSet?.join(",") ?? "";
  // relayKey is used only as a dep to re-run the effect when the initial relay
  // set changes (e.g. navigating to a different repo). The loader itself
  // subscribes to relays$ reactively for additions within the same group.
  const relayKey = repoRelayGroup?.relays.map((r) => r.url).join(",") ?? "";

  // Single subscription: drives EventStore writes AND the EOSE latch.
  // loadRepoStateFromRelays emits NostrEvent | "EOSE". Events are written
  // into the store inside the loader; "EOSE" flips the latch here.
  // Starts true when there are no relays to wait for.
  const [repoRelayEose, setRepoRelayEose] = useState<boolean>(
    () => repoRelayGroup === undefined,
  );

  useEffect(() => {
    // No relay group — nothing to fetch, already settled.
    if (
      !dTag ||
      !maintainerSet ||
      maintainerSet.length === 0 ||
      !repoRelayGroup
    ) {
      setRepoRelayEose(true);
      return;
    }

    // Reset to loading for this query.
    setRepoRelayEose(false);

    const sub = loadRepoStateFromRelays(
      pool,
      repoRelayGroup,
      dTag,
      maintainerSet,
      store,
    ).subscribe({
      next: (msg) => {
        if (msg === "EOSE") setRepoRelayEose(true);
        // Events are already written into the store by the loader.
        // store.timeline() below reacts to them automatically.
      },
      error: () => {
        // Settle on error so the UI doesn't wait forever.
        setRepoRelayEose(true);
      },
    });

    return () => sub.unsubscribe();
    // relayKey is included so the effect re-runs when the repo changes.
    // The loader handles new relays being added to an existing group reactively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dTag, maintainerKey, relayKey, store]);

  const storeFilter: Filter = {
    kinds: [REPO_STATE_KIND],
    authors: maintainerSet ?? [],
    "#d": dTag ? [dTag] : [],
  } as Filter;

  // Read back from the store and pick the winner.
  // store.timeline() is reactive — it re-emits whenever new events arrive,
  // so the winning state updates automatically as relays respond.
  const repoState = use$(() => {
    if (!dTag || !maintainerSet || maintainerSet.length === 0) return undefined;

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

  // Per-relay state registry: for each relay URL, keep the best state event
  // seen from that relay. Derived reactively from the store — no side-channel
  // state needed because the loader stamps each event with its source relay
  // via markFromRelay() before writing it to the store.
  //
  // For each valid state event, getSeenRelays() returns the set of relay URLs
  // it was received from. We invert that: for each relay URL, we keep the
  // event with the highest created_at (event ID as tiebreaker).
  const relayStateMap = use$(() => {
    if (!dTag || !maintainerSet || maintainerSet.length === 0) return undefined;

    return store.timeline([storeFilter]).pipe(
      map((events) => {
        const result = new Map<string, NostrEvent>();
        for (const event of events) {
          if (!isValidRepositoryState(event)) continue;
          const seenOn = getSeenRelays(event);
          if (!seenOn) continue;
          for (const relayUrl of seenOn) {
            const existing = result.get(relayUrl);
            if (
              !existing ||
              event.created_at > existing.created_at ||
              (event.created_at === existing.created_at &&
                event.id > existing.id)
            ) {
              result.set(relayUrl, event);
            }
          }
        }
        return result;
      }),
    ) as unknown as Observable<Map<string, NostrEvent>>;
  }, [dTag, maintainerKey, store]);

  return [repoState, repoRelayEose, relayStateMap ?? new Map()];
}
