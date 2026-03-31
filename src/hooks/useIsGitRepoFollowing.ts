import { map } from "rxjs/operators";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { useActiveAccount } from "applesauce-react/hooks";

/** kind:10018 — NIP-51 Git repositories follow list */
const GIT_REPOS_KIND = 10018;

/**
 * Returns true if the currently logged-in user has any of the given
 * repository coordinates in their NIP-51 Git repositories follow list
 * (kind:10018).
 *
 * Pass all coordinates from the recursive maintainer set — the user is
 * considered to be following the repo if ANY of them appear in their list.
 *
 * Uses store.replaceable() which subscribes reactively — it will update
 * automatically if the list changes (e.g. after an add/remove action or when
 * a newer event arrives from a relay).
 *
 * @param coords - Array of "30617:<pubkey>:<dtag>" coordinate strings
 * @returns true if following, false if not, undefined while loading
 */
export function useIsGitRepoFollowing(
  coords: string[] | undefined,
): boolean | undefined {
  const store = useEventStore();
  const account = useActiveAccount();
  const myPubkey = account?.pubkey;

  // Stable key so the dep array doesn't change on every render
  const depKey = `${myPubkey}:${(coords ?? []).sort().join(",")}`;

  return use$(() => {
    if (!myPubkey || !coords || coords.length === 0) return undefined;
    const coordSet = new Set(coords);
    return store.replaceable(GIT_REPOS_KIND, myPubkey).pipe(
      map((event) => {
        if (!event) return undefined;
        // Check if any of the repo's coordinates appear as an "a" tag
        return event.tags.some(
          ([t, v]) => t === "a" && v !== undefined && coordSet.has(v),
        );
      }),
    );
  }, [depKey, store]);
}
