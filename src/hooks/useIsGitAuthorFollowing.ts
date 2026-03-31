import { map } from "rxjs/operators";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { useActiveAccount } from "applesauce-react/hooks";
import { getPublicContacts } from "applesauce-core/helpers";

/** kind:10017 — NIP-51 Git authors follow list */
const GIT_AUTHORS_KIND = 10017;

/**
 * Returns true if the currently logged-in user has the given pubkey in their
 * NIP-51 Git authors follow list (kind:10017).
 *
 * Uses store.replaceable() which subscribes reactively — it will update
 * automatically if the list changes (e.g. after an add/remove action or when
 * a newer event arrives from a relay).
 *
 * @param pubkey - hex pubkey to check
 * @returns true if in git authors list, false if not, undefined while loading
 */
export function useIsGitAuthorFollowing(
  pubkey: string | undefined,
): boolean | undefined {
  const store = useEventStore();
  const account = useActiveAccount();
  const myPubkey = account?.pubkey;

  // Stable key so the dep array doesn't change on every render
  const depKey = `${myPubkey}:${pubkey}`;

  return use$(() => {
    if (!myPubkey || !pubkey) return undefined;
    return store.replaceable(GIT_AUTHORS_KIND, myPubkey).pipe(
      map((event) => {
        if (!event) return undefined;
        const contacts = getPublicContacts(event);
        return contacts.some((c) => c.pubkey === pubkey);
      }),
    );
  }, [depKey, store]);
}
