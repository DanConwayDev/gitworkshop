/**
 * useUserGitAuthorFollows — reactive list of pubkeys a user follows as git
 * authors.
 *
 * A user's git author follows are encoded in their kind:10017 (NIP-51 Git
 * authors follow list) as `p` tags.
 *
 * The kind:10017 event is populated into the EventStore by
 * useUserProfileSubscription (for other users' profiles) or by
 * startUserIdentitySubscription (for the signed-in user).
 *
 * This hook only reads from the in-memory EventStore — no relay queries.
 *
 * @param pubkey - The user's hex pubkey, or undefined to skip
 * @returns string[] of followed pubkeys when loaded, undefined while loading
 */

import { map } from "rxjs/operators";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";

/** kind:10017 — NIP-51 Git authors follow list */
const GIT_AUTHORS_KIND = 10017;

export function useUserGitAuthorFollows(
  pubkey: string | undefined,
): string[] | undefined {
  const store = useEventStore();

  return use$(() => {
    if (!pubkey) return undefined;

    return store.replaceable(GIT_AUTHORS_KIND, pubkey).pipe(
      map((event) => {
        if (!event) return [];
        return event.tags
          .filter(([t]) => t === "p")
          .map(([, v]) => v)
          .filter((v): v is string => !!v);
      }),
    );
  }, [pubkey, store]);
}
