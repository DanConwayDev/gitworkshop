/**
 * useRobustFollowActions — a safer alternative to calling FollowUser /
 * UnfollowUser directly via useAction.
 *
 * This is a thin wrapper around useRobustReplaceableAction that provides
 * a convenient follow/unfollow API. All connectivity checks, freshness
 * prefetching, and error handling are delegated to the generic hook.
 *
 * See useRobustReplaceableAction.ts for the full safety rationale.
 */

import { useCallback } from "react";
import { useAction } from "@/hooks/useAction";
import { FollowUser, UnfollowUser } from "applesauce-actions/actions";
import { useRobustReplaceableAction } from "@/hooks/useRobustReplaceableAction";
import type { ProfilePointer } from "applesauce-core/helpers";

/** kind:3 — NIP-02 contact / follow list */
const CONTACTS_KIND = 3;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface RobustFollowActionsResult {
  /** Follow a user. Throws if connectivity is insufficient. */
  follow: (pubkey: string | ProfilePointer) => Promise<void>;
  /** Unfollow a user. Throws if connectivity is insufficient. */
  unfollow: (pubkey: string | ProfilePointer) => Promise<void>;
  /** True while a follow or unfollow operation is in progress. */
  pending: boolean;
}

export function useRobustFollowActions(): RobustFollowActionsResult {
  const { run: followUser } = useAction(FollowUser);
  const { run: unfollowUser } = useAction(UnfollowUser);
  const { execute, pending } = useRobustReplaceableAction();

  const follow = useCallback(
    (pubkey: string | ProfilePointer) =>
      execute(CONTACTS_KIND, () => followUser(pubkey)),
    [execute, followUser],
  );

  const unfollow = useCallback(
    (pubkey: string | ProfilePointer) =>
      execute(CONTACTS_KIND, () => unfollowUser(pubkey)),
    [execute, unfollowUser],
  );

  return { follow, unfollow, pending };
}
