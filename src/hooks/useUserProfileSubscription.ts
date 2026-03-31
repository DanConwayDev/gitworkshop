/**
 * useUserProfileSubscription — subscribe to a user's replaceable events while
 * viewing their profile page.
 *
 * When we are on another user's profile page we need their kind:0, kind:3,
 * kind:10002, kind:10017, and kind:10018 events so we can display:
 *   - their profile metadata (kind:0)
 *   - their git-author follow list (kind:10017) for the "Followed Authors" tab
 *   - their git-repo follow list (kind:10018) for the "Followed" tab
 *   - their relay list (kind:10002) so we know which relays to query
 *
 * Strategy:
 *   1. Subscribe to the user's replaceable events on the git index relays
 *      immediately (before we know their personal relays).
 *   2. Once we have their kind:10002 relay list, also subscribe on their
 *      personal outbox relays so we get the freshest data.
 *
 * This hook is a no-op when:
 *   - pubkey is undefined
 *   - the viewed pubkey matches the active account (the active user's identity
 *     is already kept up-to-date by startUserIdentitySubscription in accounts.ts)
 *
 * The subscription is torn down automatically when the component unmounts
 * (use$ handles the RxJS subscription lifecycle).
 */

import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { useActiveAccount } from "applesauce-react/hooks";
import { pool } from "@/services/nostr";
import { gitIndexRelays, lookupRelays } from "@/services/settings";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { MailboxesModel } from "applesauce-core/models";
import { switchMap, of } from "rxjs";
import { map } from "rxjs/operators";
import type { Filter } from "applesauce-core/helpers";

/** Replaceable event kinds that define a user's identity and follow lists. */
const USER_REPLACEABLE_KINDS = [
  0, // profile metadata
  3, // contact / follow list
  10002, // NIP-65 relay list (mailboxes)
  10017, // NIP-51 Git authors follow list
  10018, // NIP-51 Git repositories follow list
] as const;

/**
 * Subscribe to a user's replaceable events for the duration of the profile
 * page visit. Queries both the git index / lookup relays and the user's own
 * outbox relays (once their kind:10002 is known).
 *
 * @param pubkey - The profile page owner's hex pubkey, or undefined to skip
 */
export function useUserProfileSubscription(pubkey: string | undefined): void {
  const store = useEventStore();
  const account = useActiveAccount();
  const myPubkey = account?.pubkey;

  // Skip if this is the signed-in user's own profile — their identity is
  // already subscribed to by startUserIdentitySubscription in accounts.ts.
  const isOwnProfile = !!pubkey && pubkey === myPubkey;

  // Phase 1: subscribe on index + lookup relays immediately.
  // This gives us their kind:10002 so we can discover their personal relays.
  use$(() => {
    if (!pubkey || isOwnProfile) return undefined;

    const relays = [
      ...new Set([...gitIndexRelays.getValue(), ...lookupRelays.getValue()]),
    ];

    const filter: Filter = {
      kinds: [...USER_REPLACEABLE_KINDS],
      authors: [pubkey],
    };

    return pool
      .subscription(relays, [filter], {
        reconnect: Infinity,
        resubscribe: Infinity,
      })
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [pubkey, isOwnProfile, store]);

  // Phase 2: once we have their kind:10002, also subscribe on their outbox
  // relays. switchMap tears down the previous subscription whenever the
  // outbox relay list changes (e.g. after phase 1 delivers their kind:10002).
  use$(() => {
    if (!pubkey || isOwnProfile) return undefined;

    return store.model(MailboxesModel, pubkey).pipe(
      map((mailboxes) => mailboxes?.outboxes ?? []),
      switchMap((outboxes) => {
        if (outboxes.length === 0) return of(undefined);

        const filter: Filter = {
          kinds: [...USER_REPLACEABLE_KINDS],
          authors: [pubkey],
        };

        return pool
          .subscription(outboxes, [filter], {
            reconnect: Infinity,
            resubscribe: Infinity,
          })
          .pipe(onlyEvents(), mapEventsToStore(store));
      }),
    );
  }, [pubkey, isOwnProfile, store]);
}
