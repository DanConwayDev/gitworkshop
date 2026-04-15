/**
 * useIsPinnedRepo — reactive check whether a repo coordinate is in the
 * logged-in user's pinned repos list (kind:10617).
 *
 * Returns:
 *   true      — the coord is pinned
 *   false     — the coord is not pinned (kind:10617 found but coord absent)
 *   undefined — kind:10617 not yet loaded from the store
 */

import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { useActiveAccount } from "applesauce-react/hooks";
import { PINNED_REPOS_KIND } from "@/actions/pinnedRepoActions";
import { map } from "rxjs";

export function useIsPinnedRepo(coord: string): boolean | undefined {
  const account = useActiveAccount();
  const store = useEventStore();

  return use$(() => {
    if (!account?.pubkey) return undefined;

    return store.replaceable(PINNED_REPOS_KIND, account.pubkey).pipe(
      map((event) => {
        if (!event) return undefined;
        return event.tags.some(([t, v]) => t === "a" && v === coord);
      }),
    );
  }, [account?.pubkey, coord, store]);
}
