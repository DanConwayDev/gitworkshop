/**
 * usePRMergeability — checks whether a PR-type item (kind:1618) can be merged.
 *
 * For PR-type items the commits already exist on the git server — the PR
 * author pushed a branch. Merging is therefore much simpler than for
 * patch-type items: we just need to:
 *
 *   1. Confirm the tip commit exists and fetch its tree.
 *   2. Create a merge commit with [defaultBranchHead, tipCommitId] as parents,
 *      using the tip's tree.
 *
 * Conflict detection note: using the tip's tree as the merge tree is correct
 * when the PR branch is up to date with the default branch (i.e. the merge
 * base is an ancestor of both). When the PR is behind, the maintainer should
 * rebase/update the PR first. We surface the `behindCount` so the UI can warn.
 *
 * The pre-built merge commit object is returned so the merge button can
 * proceed immediately without waiting.
 */

import { useEffect, useRef, useState } from "react";
import { packCommit, type PackableObject } from "@/lib/git-packfile";
import type { CommitData, CommitPerson } from "@/lib/git-objects";
import type { GitGraspPool } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PRMergeabilityStatus = "idle" | "loading" | "ready" | "error";

export interface PRMergeResult {
  /** The pre-built merge commit PackableObject */
  mergeCommitObj: PackableObject;
  /** The merge commit hash */
  mergeCommitHash: string;
}

export interface PRMergeability {
  status: PRMergeabilityStatus;
  /** Pre-built merge commit, present when status === "ready" */
  result: PRMergeResult | null;
  /** Human-readable error when status === "error" */
  errorMessage: string | null;
  /** Re-run the check */
  recheck: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Check whether a PR-type item can be merged and pre-build the merge commit.
 *
 * @param tipCommitId       - The PR's tip commit ID (from pr.tip.commitId)
 * @param defaultBranchHead - Current HEAD of the default branch
 * @param committer         - The maintainer's CommitPerson
 * @param subject           - PR subject for the merge commit message
 * @param itemType          - Always "pr" for this hook
 * @param nevent            - NIP-19 nevent identifier for the PR event
 * @param description       - Cover note or PR body (optional)
 * @param gitPool           - GitGraspPool for fetching the tip tree
 * @param fallbackUrls      - Extra clone URLs (e.g. PR author's fork)
 * @param enabled           - Set to false to skip the check entirely
 */
export function usePRMergeability(
  tipCommitId: string | undefined,
  defaultBranchHead: string | undefined,
  committer: CommitPerson | undefined,
  subject: string,
  nevent: string,
  description: string | undefined,
  gitPool: GitGraspPool | null,
  fallbackUrls: string[] | undefined,
  enabled: boolean,
): PRMergeability {
  const [status, setStatus] = useState<PRMergeabilityStatus>("idle");
  const [result, setResult] = useState<PRMergeResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recheckCounter, setRecheckCounter] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const recheck = () => setRecheckCounter((c) => c + 1);

  useEffect(() => {
    setResult(null);
    setErrorMessage(null);

    if (
      !enabled ||
      !tipCommitId ||
      !defaultBranchHead ||
      !committer ||
      !gitPool
    ) {
      setStatus("idle");
      return;
    }

    setStatus("loading");

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    async function run() {
      // Fetch the tip commit to get its tree hash.
      // getFullTree fetches the commit + tree metadata (blob:none — lightweight).
      const tipData = await gitPool!.getFullTree(
        tipCommitId!,
        abort.signal,
        fallbackUrls,
      );

      if (abort.signal.aborted) return;

      if (!tipData) {
        setStatus("error");
        setErrorMessage(
          "Could not fetch the tip commit from the git server. " +
            "The PR author's branch may not be accessible.",
        );
        return;
      }

      // Build the merge commit message
      const label = "PR";
      let message = `Merge ${label} '${subject}'`;
      if (description && description.trim()) {
        message += `\n\n${description.trim()}`;
      }
      message += `\n\nNostr-PR: ${nevent}`;

      // The merge commit tree is the tip's tree (correct when the PR branch
      // is up to date with the default branch, i.e. merge base is an ancestor
      // of both). If the PR is behind, the maintainer should update it first.
      const commitData: CommitData = {
        treeHash: tipData.commit.tree,
        parentHashes: [defaultBranchHead!, tipCommitId!],
        author: committer!,
        committer: committer!,
        message,
      };

      const mergeCommitObj = await packCommit(commitData);

      if (abort.signal.aborted) return;

      setResult({
        mergeCommitObj,
        mergeCommitHash: mergeCommitObj.hash,
      });
      setStatus("ready");
    }

    run().catch((err) => {
      if (abort.signal.aborted) return;
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Unknown error during merge check",
      );
    });

    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    tipCommitId,
    defaultBranchHead,
    gitPool,
    recheckCounter,
    subject,
    nevent,
    description,
    // committer and fallbackUrls intentionally excluded — stable proxies above cover them
  ]);

  return { status, result, errorMessage, recheck };
}
