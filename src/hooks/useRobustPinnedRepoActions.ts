/**
 * useRobustPinnedRepoActions — safe pin/unpin for the pinned git repositories
 * list (kind:10617).
 *
 * Thin wrapper around useRobustReplaceableAction that provides a convenient
 * pin/unpin API. All connectivity checks, freshness prefetching, and error
 * handling are delegated to the generic hook.
 *
 * kind:10617 is new and most users won't have one yet, so silently creating a
 * fresh list is the expected behaviour (no warning dialog needed).
 *
 * See useRobustReplaceableAction.ts for the full safety rationale.
 */

import { useCallback } from "react";
import { useAction } from "@/hooks/useAction";
import { useRobustReplaceableAction } from "@/hooks/useRobustReplaceableAction";
import {
  PinGitRepo,
  UnpinGitRepo,
  PINNED_REPOS_KIND,
} from "@/actions/pinnedRepoActions";

export interface RobustPinnedRepoActionsResult {
  /** Add a repo coordinate to the pinned repos list. Throws if connectivity is insufficient. */
  pinRepo: (coord: string) => Promise<void>;
  /** Remove a repo coordinate from the pinned repos list. Throws if connectivity is insufficient. */
  unpinRepo: (coord: string) => Promise<void>;
  /** True while a pin or unpin operation is in progress. */
  pending: boolean;
}

export function useRobustPinnedRepoActions(): RobustPinnedRepoActionsResult {
  const { run: pinRepoAction } = useAction(PinGitRepo);
  const { run: unpinRepoAction } = useAction(UnpinGitRepo);
  const { execute, pending } = useRobustReplaceableAction();

  const pinRepo = useCallback(
    (coord: string) => execute(PINNED_REPOS_KIND, () => pinRepoAction(coord)),
    [execute, pinRepoAction],
  );

  const unpinRepo = useCallback(
    (coord: string) => execute(PINNED_REPOS_KIND, () => unpinRepoAction(coord)),
    [execute, unpinRepoAction],
  );

  return { pinRepo, unpinRepo, pending };
}
