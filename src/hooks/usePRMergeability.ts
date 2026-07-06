/**
 * usePRMergeability — checks whether a PR-type item (kind:1618) can be merged.
 *
 * For PR-type items the commits already exist on the git server — the PR
 * author pushed a branch. The merge:
 *
 *   1. Confirms the tip commit exists and fetches its tree.
 *   2. Computes the REAL merge base between the current default-branch tip and
 *      the PR tip from git history — NOT the PR event's claimed `merge-base`
 *      tag, which may be wrong (an incorrect ngit merge base is exactly the
 *      bug that caused a non-fast-forward, history-losing merge).
 *   3. If the default branch has not advanced past the merge base (merge base
 *      === default-branch tip), the PR tip's tree is correct as-is — the
 *      classic fast path.
 *   4. Otherwise it performs a real three-way merge of the PR tip into the
 *      default branch tip over their common ancestor, so changes made on the
 *      default branch since the base are preserved instead of being silently
 *      reverted. Auto-merge conflicts are surfaced as `conflicts`.
 *   5. Builds a merge commit with [defaultBranchHead, tipCommitId] as parents
 *      and the (possibly three-way-merged) tree.
 *
 * The pre-built merge commit object plus any NEW objects the three-way merge
 * produced (rebuilt trees, auto-merged blobs) are returned so the merge button
 * can push them with the PR branch objects fetched from the author's clone URL.
 */

import { useEffect, useRef, useState } from "react";
import { packCommit, type PackableObject } from "@/lib/git-packfile";
import type { CommitData, CommitPerson } from "@/lib/git-objects";
import { mergeThreeWayTree, buildMergeCommitMessage } from "@/lib/patch-merge";
import type { MergeConflict } from "@/lib/patch-merge";
import type { GitGraspPool } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PRMergeabilityStatus =
  "idle" | "loading" | "ready" | "conflicts" | "error";

export interface PRMergeResult {
  /** The pre-built merge commit PackableObject */
  mergeCommitObj: PackableObject;
  /** The merge commit hash */
  mergeCommitHash: string;
  /** The computed merge base used for the merge. */
  mergeBase: string;
  /**
   * NEW git objects (rebuilt trees + auto-merged blobs) produced by a
   * three-way merge that MUST be pushed alongside the merge commit. Empty for
   * the fast path (PR tip tree adopted verbatim).
   */
  extraObjects: PackableObject[];
}

export interface MergeBaseMismatch {
  /** The merge base the PR event's `merge-base` tag claims. */
  claimed: string;
  /** The merge base actually computed from git history. */
  computed: string;
}

export interface PRMergeability {
  status: PRMergeabilityStatus;
  /** Pre-built merge commit, present when status === "ready" */
  result: PRMergeResult | null;
  /** File-level conflicts when status === "conflicts" */
  conflicts: MergeConflict[];
  /** Human-readable error when status === "error" */
  errorMessage: string | null;
  /**
   * Set when the PR event's claimed `merge-base` tag disagrees with the merge
   * base computed from git history. A mismatch means the PR author's tooling
   * (e.g. ngit) recorded a stale/incorrect merge base — the exact condition
   * that can drag unrelated commits into the PR or produce a history-losing
   * merge. The merge itself always uses the computed base (so it stays safe),
   * but the maintainer should be warned that the PR metadata is untrustworthy.
   */
  mergeBaseMismatch: MergeBaseMismatch | null;
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
 * @param rootEventId       - The PR root event id (for the `#<hex8>` shorthand)
 * @param subject           - PR subject for the merge commit message
 * @param nevent            - NIP-19 nevent identifier for the PR event
 * @param authorPubkey      - PR author pubkey (hex) for the PR-Author trailer
 * @param authorName        - PR author display name (optional, kind-0 metadata)
 * @param coverNote         - Cover note body (kind:1624), optional
 * @param description       - PR body, used when no cover note is present
 * @param gitPool           - GitGraspPool for fetching the tip tree
 * @param fallbackUrls      - Extra clone URLs (e.g. PR author's fork)
 * @param enabled           - Set to false to skip the check entirely
 * @param claimedMergeBase  - The PR event's `merge-base` tag (if present), used
 *                            only to detect and warn about a mismatch with the
 *                            merge base computed from git history.
 */
export function usePRMergeability(
  tipCommitId: string | undefined,
  defaultBranchHead: string | undefined,
  committer: CommitPerson | undefined,
  rootEventId: string,
  subject: string,
  nevent: string,
  authorPubkey: string,
  authorName: string | undefined,
  coverNote: string | undefined,
  description: string | undefined,
  gitPool: GitGraspPool | null,
  fallbackUrls: string[] | undefined,
  enabled: boolean,
  claimedMergeBase?: string,
): PRMergeability {
  const [status, setStatus] = useState<PRMergeabilityStatus>("idle");
  const [result, setResult] = useState<PRMergeResult | null>(null);
  const [conflicts, setConflicts] = useState<MergeConflict[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mergeBaseMismatch, setMergeBaseMismatch] =
    useState<MergeBaseMismatch | null>(null);
  const [recheckCounter, setRecheckCounter] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const recheck = () => setRecheckCounter((c) => c + 1);

  useEffect(() => {
    setResult(null);
    setConflicts([]);
    setErrorMessage(null);
    setMergeBaseMismatch(null);

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

      // Build the merge commit message (ngit merge format).
      const message = buildMergeCommitMessage({
        rootEventId,
        title: subject,
        nevent,
        authorPubkey,
        authorName,
        coverNote,
        description,
      });

      // Compute the REAL merge base from git history (NOT the PR's claimed
      // merge-base tag, which may be wrong). This is the common ancestor of the
      // default-branch tip and the PR tip.
      const mergeBase = await gitPool!.findMergeBaseBetween(
        defaultBranchHead!,
        tipCommitId!,
        abort.signal,
        fallbackUrls,
      );

      if (abort.signal.aborted) return;

      if (!mergeBase) {
        setStatus("error");
        setErrorMessage(
          "Could not determine the merge base between the default branch and " +
            "the PR tip from git history. Refusing to merge — adopting the PR " +
            "tree blindly could orphan commits on the default branch.",
        );
        return;
      }

      // Detect a stale/incorrect claimed merge base. The PR event's
      // `merge-base` tag should equal the common ancestor of the default
      // branch and the PR tip — advancing the default branch forward does NOT
      // change that ancestor. So when the claimed tag disagrees with the
      // computed base, the PR author's tooling miscalculated (or the branch was
      // rewritten): a red flag worth surfacing even though the merge below
      // uses the computed base and stays safe.
      if (claimedMergeBase && claimedMergeBase !== mergeBase) {
        setMergeBaseMismatch({
          claimed: claimedMergeBase,
          computed: mergeBase,
        });
      }

      // Decide the merge tree.
      //   Fast path: the default branch has NOT advanced past the merge base,
      //   so the PR tip's tree already incorporates everything on the branch —
      //   adopt it verbatim. The push path still includes PR branch objects,
      //   because forked PR commits may not exist on the target server.
      //   Diverged: perform a real three-way merge so changes made on the
      //   default branch since the base are preserved.
      let mergeTreeHash = tipData.commit.tree;
      let extraObjects: PackableObject[] = [];

      if (mergeBase !== defaultBranchHead) {
        const [baseData, oursData] = await Promise.all([
          gitPool!.getFullTree(mergeBase, abort.signal, fallbackUrls),
          gitPool!.getFullTree(defaultBranchHead!, abort.signal, fallbackUrls),
        ]);

        if (abort.signal.aborted) return;

        if (!baseData || !oursData) {
          setStatus("error");
          setErrorMessage(
            "Could not fetch the merge-base or default-branch tree from the " +
              "git server — cannot compute a safe three-way merge.",
          );
          return;
        }

        const merged = await mergeThreeWayTree(
          gitPool!,
          abort.signal,
          baseData.tree,
          oursData.tree,
          tipData.tree,
          fallbackUrls,
        );

        if (abort.signal.aborted) return;

        if ("reason" in merged) {
          setStatus("conflicts");
          setConflicts(merged.conflicts);
          setErrorMessage(merged.reason);
          return;
        }

        mergeTreeHash = merged.mergeTreeHash;
        extraObjects = merged.objects;
      }

      const commitData: CommitData = {
        treeHash: mergeTreeHash,
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
        mergeBase,
        extraObjects,
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
    rootEventId,
    subject,
    nevent,
    authorPubkey,
    authorName,
    coverNote,
    description,
    claimedMergeBase,
    // committer and fallbackUrls intentionally excluded — stable proxies above cover them
  ]);

  return {
    status,
    result,
    conflicts,
    errorMessage,
    mergeBaseMismatch,
    recheck,
  };
}
