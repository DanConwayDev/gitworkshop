/**
 * useUserStarredRepos — reactive list of repositories a user has starred.
 *
 * Stars are kind:7 reactions with content "+" and a `k` tag of "30617",
 * authored by the user. The `a` tag on each reaction gives the repo coordinate
 * "30617:<pubkey>:<dtag>".
 *
 * Strategy:
 *   Layer 1a — single reactive subscription for the user's kind:7 reactions.
 *              Starts immediately on index + lookup relays and additively
 *              expands to the user's outbox relays once their kind:10002 arrives.
 *   Layer 1b — watch those reactions reactively; when coords change, fetch the
 *              corresponding repo announcements from git index relays (where
 *              kind:30617 announcements live). Passes gitIndexRelays as an
 *              observable so relay list changes are handled reactively.
 *   Layer 2  — read both reactions and repo announcements from the EventStore
 *              reactively and return resolved repos filtered to starred coords.
 *
 * All relay fetches are managed as RxJS subscriptions via use$, so they are
 * torn down automatically when the component unmounts.
 */

import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { pool } from "@/services/nostr";
import { gitIndexRelays, lookupRelays } from "@/services/settings";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { resilientSubscription } from "@/lib/resilientSubscription";
import { normalizeUrl } from "@/lib/url";

import {
  REPO_KIND,
  groupIntoResolvedRepos,
  type ResolvedRepo,
} from "@/lib/nip34";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import {
  switchMap,
  map,
  of,
  combineLatest,
  distinctUntilChanged,
  startWith,
} from "rxjs";

/** kind:7 — NIP-25 reaction */
const REACTION_KIND = 7;

/** Filter for kind:7 reactions targeting kind:30617 repo announcements. */
function starReactionFilter(pubkey: string): Filter {
  return {
    kinds: [REACTION_KIND],
    authors: [pubkey],
    "#k": ["30617"],
  } as Filter;
}

/**
 * Return the list of repositories starred by the given user.
 *
 * @param pubkey - The user's hex pubkey, or undefined to skip
 * @returns ResolvedRepo[] when loaded, undefined while loading
 */
export function useUserStarredRepos(
  pubkey: string | undefined,
): ResolvedRepo[] | undefined {
  const store = useEventStore();

  // Layer 1a — single reactive subscription: starts on index + lookup relays
  // immediately and additively expands to the user's outbox relays once their
  // kind:10002 arrives. No teardown on relay list changes.
  use$(() => {
    if (!pubkey) return undefined;

    const relays$ = combineLatest([
      gitIndexRelays,
      lookupRelays,
      store.mailboxes(pubkey).pipe(startWith(undefined)),
    ]).pipe(
      map(([index, lookup, mailboxes]) => [
        ...new Set(
          [...index, ...lookup, ...(mailboxes?.outboxes ?? [])].map(
            normalizeUrl,
          ),
        ),
      ]),
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
      ),
    );

    return resilientSubscription(pool, relays$, [
      starReactionFilter(pubkey),
    ]).pipe(onlyEvents(), mapEventsToStore(store));
  }, [pubkey, store]);

  // Layer 1b: watch the reactions in the store; when the starred coords change,
  // fetch the corresponding repo announcements from git index relays (where
  // kind:30617 announcements are published). gitIndexRelays is passed as an
  // observable so relay list changes are handled reactively.
  use$(() => {
    if (!pubkey) return undefined;

    return (
      store.timeline([starReactionFilter(pubkey)]) as unknown as Observable<
        NostrEvent[]
      >
    ).pipe(
      map((reactions) =>
        reactions
          .filter((ev) => ev.content === "+")
          .map((ev) => ev.tags.find(([t]) => t === "a")?.[1])
          .filter((v): v is string => !!v),
      ),
      switchMap((coords) => {
        if (coords.length === 0) return of(undefined);

        const coordPubkeys = [
          ...new Set(
            coords
              .map((c) => c.split(":")[1])
              .filter((pk): pk is string => !!pk),
          ),
        ];

        const repoFilter: Filter = {
          kinds: [REPO_KIND],
          authors: coordPubkeys,
        };

        return resilientSubscription(pool, gitIndexRelays, [repoFilter]).pipe(
          onlyEvents(),
          mapEventsToStore(store),
        );
      }),
    );
  }, [pubkey, store]);

  // Layer 2: read reactions and repo announcements from the store reactively,
  // filter to only starred coords, and return resolved repos.
  return use$(() => {
    if (!pubkey) return undefined;

    return (
      store.timeline([starReactionFilter(pubkey)]) as unknown as Observable<
        NostrEvent[]
      >
    ).pipe(
      map((reactions) =>
        reactions
          .filter((ev) => ev.content === "+")
          .map((ev) => ev.tags.find(([t]) => t === "a")?.[1])
          .filter((v): v is string => !!v),
      ),
      switchMap((coords) => {
        if (coords.length === 0) return of([] as ResolvedRepo[]);

        const coordSet = new Set(coords);
        const coordPubkeys = [
          ...new Set(
            coords
              .map((c) => c.split(":")[1])
              .filter((pk): pk is string => !!pk),
          ),
        ];

        const repoFilter: Filter = {
          kinds: [REPO_KIND],
          authors: coordPubkeys,
        };

        return (
          store.timeline([repoFilter]) as unknown as Observable<NostrEvent[]>
        ).pipe(
          map((events) => {
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
