/**
 * useAuthoritativeDefaultBranch — resolve the authoritative default-branch
 * name + tip commit for merge evaluation and merge pushes.
 *
 * The authoritative tip is NOT always the signed kind:30618 state head:
 *
 * - Normally (git servers agree with the state, or mirrors are still
 *   converging after a push) the signed state head is authoritative. Using
 *   `gitPoolState.latestCommit` here is wrong: while mirrors converge it can
 *   point at whichever server head won the git-info race, causing mergeability
 *   to re-run against a stale tip right after a merge push.
 *
 * - When a git server is legitimately AHEAD of the signed state (a maintainer
 *   pushed without updating the state event — the pool reports this as the
 *   `state-behind-git` warning), the git head is authoritative. Preparing a
 *   merge against the stale state head would (a) fail the push's
 *   compare-and-swap (`oldHash` != the server's actual ref) on every
 *   up-to-date server, and (b) sign a kind:30618 update that orphans the
 *   commits already on the branch — `assertFastForwardSafe` only checks
 *   descent from the head we hand it. The merge pipeline already supports
 *   this topology (`issueScanObjects` / `gitHeadIsAheadOfState` in
 *   `git-grasp-pool/merge.ts`); it just needs the real git head.
 *
 * The git-ahead head is only trusted after an ancestry check confirms the
 * state head is reachable from it. This guards against two hazards:
 *
 * - The pool's fast-path can emit a *stale* `state-behind-git` warning from
 *   cached infoRefs right after a merge push (old server head vs the new
 *   state head). The old head does not contain the new state head, so the
 *   check fails and the state head correctly stays authoritative.
 * - A rewritten/divergent server head (the warning is committer-date based,
 *   not ancestry based) must not become the merge target — advancing the
 *   signed state to it would drop signed history. The signed state remains
 *   the trust anchor unless the git head strictly extends it.
 */

import { useEffect, useState } from "react";
import type { GitGraspPool, PoolState } from "@/lib/git-grasp-pool";
import type { RepositoryState } from "@/casts/RepositoryState";

/** How many commits to walk when verifying the state head is an ancestor. */
const ANCESTRY_MAX_DEPTH = 500;

export interface AuthoritativeDefaultBranch {
  /** Default branch name (e.g. "main"), state event first, then git HEAD. */
  defaultBranchName: string | undefined;
  /** The authoritative tip commit of the default branch. */
  defaultBranchHead: string | undefined;
}

export function useAuthoritativeDefaultBranch(
  gitPool: GitGraspPool | null,
  gitPoolState: PoolState,
  repoState: RepositoryState | null | undefined,
): AuthoritativeDefaultBranch {
  const stateHead = repoState?.headCommitId;
  const warning = gitPoolState.warning;

  // Candidate git head that claims to be ahead of the current state head.
  // Only considered when the warning refers to the state head we hold —
  // a version-skew mismatch simply falls back to the state head.
  const aheadGitHead =
    warning?.kind === "state-behind-git" && warning.stateCommitId === stateHead
      ? warning.gitCommitId
      : undefined;

  const [verifiedGitHead, setVerifiedGitHead] = useState<string | null>(null);

  useEffect(() => {
    if (!gitPool || !aheadGitHead || !stateHead) return;

    const abort = new AbortController();
    gitPool
      .getCommitHistory(
        aheadGitHead,
        ANCESTRY_MAX_DEPTH,
        abort.signal,
        undefined,
        stateHead,
      )
      .then((history) => {
        if (abort.signal.aborted) return;
        setVerifiedGitHead(
          history?.some((commit) => commit.hash === stateHead)
            ? aheadGitHead
            : null,
        );
      })
      .catch(() => {
        // Verification failed — keep the signed state head authoritative.
      });

    return () => abort.abort();
  }, [gitPool, aheadGitHead, stateHead]);

  // While verification is pending (or failed), the signed state head wins.
  const gitHeadIsAuthoritative =
    aheadGitHead !== undefined && verifiedGitHead === aheadGitHead;

  return {
    defaultBranchName:
      repoState?.headBranch ?? gitPoolState.defaultBranch ?? undefined,
    defaultBranchHead: gitHeadIsAuthoritative
      ? aheadGitHead
      : (stateHead ?? gitPoolState.latestCommit?.hash),
  };
}
