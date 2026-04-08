/**
 * useUserFollowedRepos — reactive list of repositories a user follows.
 *
 * A user's followed repos are encoded in their kind:10018 (NIP-51 Git
 * repositories follow list) as `a` tags with the repo coordinate
 * "30617:<pubkey>:<dtag>".
 *
 * Strategy:
 *   1. Subscribe reactively to the user's kind:10018 from the EventStore
 *      (populated by useUserProfileSubscription).
 *   2. Extract the `a` tag coordinates.
 *   3. Fetch the actual kind:30617 repo announcements for those coordinates
 *      from the git index relays.
 *   4. Return resolved repos via groupIntoResolvedRepos, scoped to the coords
 *      so only the followed repos appear.
 *
 * Reading counts and content from the in-memory EventStore (not directly from
 * relays) keeps the display reactive and avoids duplicate relay queries.
 */

import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { pool } from "@/services/nostr";
import { gitIndexRelays } from "@/services/settings";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { resilientSubscription } from "@/lib/resilientSubscription";
import {
  REPO_KIND,
  groupIntoResolvedRepos,
  type ResolvedRepo,
} from "@/lib/nip34";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";
import { switchMap, map, of } from "rxjs";

/** kind:10018 — NIP-51 Git repositories follow list */
const GIT_REPOS_KIND = 10018;

/**
 * Return the list of repositories followed by the given user.
 *
 * @param pubkey - The user's hex pubkey, or undefined to skip
 * @returns ResolvedRepo[] when loaded, undefined while loading
 */
export function useUserFollowedRepos(
  pubkey: string | undefined,
): ResolvedRepo[] | undefined {
  const store = useEventStore();

  // Layer 1: watch kind:10018 reactively; when coords change, fetch the
  // corresponding repo announcements from the git index relays.
  use$(() => {
    if (!pubkey) return undefined;

    return store.replaceable(GIT_REPOS_KIND, pubkey).pipe(
      map((event) => {
        if (!event) return [];
        return event.tags
          .filter(([t]) => t === "a")
          .map(([, v]) => v)
          .filter((v): v is string => !!v);
      }),
      switchMap((coords) => {
        if (coords.length === 0) return of(undefined);

        const filter = {
          kinds: [REPO_KIND],
          "#d": coords.map((c) => c.split(":")[2]).filter(Boolean),
        } as Filter;

        return resilientSubscription(pool, gitIndexRelays.getValue(), [
          filter,
        ]).pipe(onlyEvents(), mapEventsToStore(store));
      }),
    );
  }, [pubkey, store]);

  // Layer 2: read resolved repos from the store, filtered to only the coords
  // in the user's kind:10018 list.
  return use$(() => {
    if (!pubkey) return undefined;

    return store.replaceable(GIT_REPOS_KIND, pubkey).pipe(
      map((event) => {
        const coords = event
          ? event.tags
              .filter(([t]) => t === "a")
              .map(([, v]) => v)
              .filter((v): v is string => !!v)
          : [];
        return coords;
      }),
      switchMap((coords) => {
        if (coords.length === 0) return of([] as ResolvedRepo[]);

        // Extract the pubkeys from the coords so we can filter repo events
        const coordPubkeys = [
          ...new Set(
            coords
              .map((c) => c.split(":")[1])
              .filter((pk): pk is string => !!pk),
          ),
        ];

        const filter: Filter = {
          kinds: [REPO_KIND],
          authors: coordPubkeys,
        };

        return (
          store.timeline([filter]) as unknown as Observable<
            import("nostr-tools").NostrEvent[]
          >
        ).pipe(
          map((events) => {
            const coordSet = new Set(coords);
            // Only include repo events whose coordinate is in the follow list
            const relevant = events.filter((ev) => {
              const d = ev.tags.find(([t]) => t === "d")?.[1];
              if (!d) return false;
              return coordSet.has(`${REPO_KIND}:${ev.pubkey}:${d}`);
            });
            return groupIntoResolvedRepos(relevant);
          }),
        );
      }),
    );
  }, [pubkey, store]);
}
