/**
 * useUserStarredRepos — reactive list of repositories a user has starred.
 *
 * Stars are kind:7 reactions with content "+" and a `k` tag of "30617",
 * authored by the user. The `a` tag on each reaction gives the repo coordinate
 * "30617:<pubkey>:<dtag>".
 *
 * Strategy:
 *   Layer 1a — subscribe to the user's kind:7 reactions (k=30617) on their
 *              outbox relays (discovered via MailboxesModel). kind:7 is a
 *              regular event published to the user's own outbox, NOT to git
 *              index relays. We use the same two-phase pattern as
 *              useUserProfileSubscription: lookup relays first (to get
 *              kind:10002), then outbox relays once known.
 *   Layer 1b — watch those reactions reactively; when coords change, fetch the
 *              corresponding repo announcements from git index relays (where
 *              kind:30617 announcements live).
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

import {
  REPO_KIND,
  groupIntoResolvedRepos,
  type ResolvedRepo,
} from "@/lib/nip34";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import { switchMap, map, of } from "rxjs";

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

  // Layer 1a — Phase 1: query lookup relays immediately so we can discover
  // the user's kind:10002 outbox relay list. kind:7 reactions are regular
  // events published to the user's own outbox, not to git index relays.
  use$(() => {
    if (!pubkey) return undefined;

    const relays = [
      ...new Set([...gitIndexRelays.getValue(), ...lookupRelays.getValue()]),
    ];

    return pool
      .subscription(relays, [starReactionFilter(pubkey)], {
        reconnect: Infinity,
        resubscribe: Infinity,
      })
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [pubkey, store]);

  // Layer 1a — Phase 2: once we have their kind:10002, subscribe on their
  // outbox relays. switchMap tears down the previous subscription when the
  // outbox list changes (e.g. after phase 1 delivers their kind:10002).
  use$(() => {
    if (!pubkey) return undefined;

    return store.mailboxes(pubkey).pipe(
      map((mailboxes) => mailboxes?.outboxes ?? []),
      switchMap((outboxes) => {
        if (outboxes.length === 0) return of(undefined);

        return pool
          .subscription(outboxes, [starReactionFilter(pubkey)], {
            reconnect: Infinity,
            resubscribe: Infinity,
          })
          .pipe(onlyEvents(), mapEventsToStore(store));
      }),
    );
  }, [pubkey, store]);

  // Layer 1b: watch the reactions in the store; when the starred coords change,
  // fetch the corresponding repo announcements from git index relays (where
  // kind:30617 announcements are published).
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

        return pool
          .subscription(gitIndexRelays.getValue(), [repoFilter], {
            reconnect: Infinity,
            resubscribe: Infinity,
          })
          .pipe(onlyEvents(), mapEventsToStore(store));
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
