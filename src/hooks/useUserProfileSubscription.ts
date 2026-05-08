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
 *   Single reactive subscription that starts immediately on the git index /
 *   lookup relays and additively expands to the user's personal outbox relays
 *   once their kind:10002 arrives — without ever tearing down the existing
 *   relay connections.
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
import { resilientSubscription } from "@/lib/resilientSubscription";
import { combineLatest } from "rxjs";
import { map, distinctUntilChanged, startWith } from "rxjs/operators";
import type { Filter } from "applesauce-core/helpers";
import { normalizeUrl } from "@/lib/url";

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
 * page visit. Starts immediately on index + lookup relays and additively
 * expands to the user's outbox relays once their kind:10002 is known.
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

  use$(() => {
    if (!pubkey || isOwnProfile) return undefined;

    const filter: Filter = {
      kinds: [...USER_REPLACEABLE_KINDS],
      authors: [pubkey],
    };

    // Reactive relay list: starts with index + lookup relays immediately, then
    // additively expands to include the user's outbox relays once their
    // kind:10002 arrives. resilientSubscription diffs on each emission so
    // existing relay connections are never torn down.
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

    return resilientSubscription(pool, relays$, [filter]).pipe(
      onlyEvents(),
      mapEventsToStore(store),
    );
  }, [pubkey, isOwnProfile, store]);
}
