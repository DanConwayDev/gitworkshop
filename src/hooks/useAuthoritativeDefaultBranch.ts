/**
 * useAuthoritativeDefaultBranch — resolve the authoritative default-branch
 * name + tip commit for merge evaluation, merge pushes and apply-to-tip.
 *
 * The heavy lifting lives in the pool itself: `PoolState.authoritativeHead`
 * (see `git-grasp-pool/types.ts`) reconciles the signed kind:30618 state head
 * against the git servers' heads, including the ancestry-verified
 * "git server is legitimately ahead of the state event" case. This hook just
 * pairs it with the branch name and falls back to the raw state head / pool
 * head while the pool is still resolving.
 */

import type { PoolState } from "@/lib/git-grasp-pool";
import type { RepositoryState } from "@/casts/RepositoryState";

export interface AuthoritativeDefaultBranch {
  /** Default branch name (e.g. "main"), state event first, then git HEAD. */
  defaultBranchName: string | undefined;
  /** The authoritative tip commit of the default branch. */
  defaultBranchHead: string | undefined;
}

export function useAuthoritativeDefaultBranch(
  gitPoolState: PoolState,
  repoState: RepositoryState | null | undefined,
): AuthoritativeDefaultBranch {
  return {
    defaultBranchName:
      repoState?.headBranch ?? gitPoolState.defaultBranch ?? undefined,
    defaultBranchHead:
      gitPoolState.authoritativeHead?.commitId ??
      repoState?.headCommitId ??
      gitPoolState.latestCommit?.hash,
  };
}
