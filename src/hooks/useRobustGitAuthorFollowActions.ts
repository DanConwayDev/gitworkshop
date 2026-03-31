/**
 * useRobustGitAuthorFollowActions — safe add/remove for the NIP-51 Git authors
 * follow list (kind:10017).
 *
 * Thin wrapper around useRobustReplaceableAction that provides a convenient
 * add/remove API. All connectivity checks, freshness prefetching, and error
 * handling are delegated to the generic hook.
 *
 * Unlike the social follow (kind:3), we do NOT warn when no existing list is
 * found — kind:10017 is new and most users won't have one yet, so silently
 * creating a fresh list is the expected behaviour.
 *
 * See useRobustReplaceableAction.ts for the full safety rationale.
 */

import { useCallback } from "react";
import { useAction } from "@/hooks/useAction";
import { useRobustReplaceableAction } from "@/hooks/useRobustReplaceableAction";
import {
  AddGitAuthor,
  RemoveGitAuthor,
  GIT_AUTHORS_KIND,
} from "@/actions/gitAuthorFollowActions";
import type { ProfilePointer } from "applesauce-core/helpers";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface RobustGitAuthorFollowActionsResult {
  /** Add a user to the git authors follow list. Throws if connectivity is insufficient. */
  addGitAuthor: (pubkey: string | ProfilePointer) => Promise<void>;
  /** Remove a user from the git authors follow list. Throws if connectivity is insufficient. */
  removeGitAuthor: (pubkey: string | ProfilePointer) => Promise<void>;
  /** True while an add or remove operation is in progress. */
  pending: boolean;
}

export function useRobustGitAuthorFollowActions(): RobustGitAuthorFollowActionsResult {
  const { run: addAuthor } = useAction(AddGitAuthor);
  const { run: removeAuthor } = useAction(RemoveGitAuthor);
  const { execute, pending } = useRobustReplaceableAction();

  const addGitAuthor = useCallback(
    (pubkey: string | ProfilePointer) =>
      execute(GIT_AUTHORS_KIND, () => addAuthor(pubkey)),
    [execute, addAuthor],
  );

  const removeGitAuthor = useCallback(
    (pubkey: string | ProfilePointer) =>
      execute(GIT_AUTHORS_KIND, () => removeAuthor(pubkey)),
    [execute, removeAuthor],
  );

  return { addGitAuthor, removeGitAuthor, pending };
}
