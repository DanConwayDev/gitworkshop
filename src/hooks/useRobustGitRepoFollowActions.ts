/**
 * useRobustGitRepoFollowActions — safe add/remove for the NIP-51 Git
 * repositories follow list (kind:10018).
 *
 * Thin wrapper around useRobustReplaceableAction that provides a convenient
 * follow/unfollow API. All connectivity checks, freshness prefetching, and
 * error handling are delegated to the generic hook.
 *
 * Unlike the social follow (kind:3), we do NOT warn when no existing list is
 * found — kind:10018 is new and most users won't have one yet, so silently
 * creating a fresh list is the expected behaviour.
 *
 * See useRobustReplaceableAction.ts for the full safety rationale.
 */

import { useCallback } from "react";
import { useAction } from "@/hooks/useAction";
import { useRobustReplaceableAction } from "@/hooks/useRobustReplaceableAction";
import {
  AddGitRepo,
  RemoveGitRepo,
  GIT_REPOS_KIND,
} from "@/actions/gitRepoFollowActions";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface RobustGitRepoFollowActionsResult {
  /** Add all repo coordinates to the git repos follow list. Throws if connectivity is insufficient. */
  followRepo: (...coords: string[]) => Promise<void>;
  /** Remove all repo coordinates from the git repos follow list. Throws if connectivity is insufficient. */
  unfollowRepo: (...coords: string[]) => Promise<void>;
  /** True while a follow or unfollow operation is in progress. */
  pending: boolean;
}

export function useRobustGitRepoFollowActions(): RobustGitRepoFollowActionsResult {
  const { run: addRepo } = useAction(AddGitRepo);
  const { run: removeRepo } = useAction(RemoveGitRepo);
  const { execute, pending } = useRobustReplaceableAction();

  const followRepo = useCallback(
    (...coords: string[]) => execute(GIT_REPOS_KIND, () => addRepo(...coords)),
    [execute, addRepo],
  );

  const unfollowRepo = useCallback(
    (...coords: string[]) =>
      execute(GIT_REPOS_KIND, () => removeRepo(...coords)),
    [execute, removeRepo],
  );

  return { followRepo, unfollowRepo, pending };
}
