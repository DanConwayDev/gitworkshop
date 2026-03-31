import { map } from "rxjs/operators";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { useActiveAccount } from "applesauce-react/hooks";
import { PublicContactsModel } from "applesauce-core/models";

/**
 * Returns true if the currently logged-in user follows the given pubkey.
 *
 * Uses PublicContactsModel which subscribes reactively to the contacts event
 * in the EventStore — it will update automatically if the contacts list
 * changes (e.g. after a follow/unfollow action or when a newer event arrives
 * from a relay).
 *
 * The underlying FollowUser / UnfollowUser actions from applesauce-actions
 * always read the latest contacts event via factory.modify() before writing,
 * so concurrent updates from other devices are never silently overwritten.
 *
 * @param pubkey - hex pubkey to check
 * @returns true if following, false if not, undefined while loading
 */
export function useIsFollowing(
  pubkey: string | undefined,
): boolean | undefined {
  const store = useEventStore();
  const account = useActiveAccount();
  const myPubkey = account?.pubkey;

  // Stable key so the dep array doesn't change on every render
  const depKey = `${myPubkey}:${pubkey}`;

  return use$(() => {
    if (!myPubkey || !pubkey) return undefined;
    return store.model(PublicContactsModel, myPubkey).pipe(
      map((contacts) => {
        if (!contacts) return undefined;
        return contacts.some((c) => c.pubkey === pubkey);
      }),
    );
  }, [depKey, store]);
}
