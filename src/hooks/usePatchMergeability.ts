/**
 * usePatchMergeability — eagerly checks whether a patch chain can be merged
 * or applied to the default branch.
 *
 * Runs two strategies in parallel on mount (and when deps change):
 *
 *   1. **Merge strategy** (`buildPatchChainObjects`): applies patches against
 *      the original merge-base (parent-commit tag, or timestamp-guessed).
 *      Produces a merge commit with two parents.
 *
 *   2. **Apply-to-tip strategy** (`applyPatchChainToTip`): applies patches
 *      directly on top of the current default branch HEAD, producing linear
 *      commits (no merge commit). Equivalent to `git am`.
 *
 * Priority:
 *   - If merge strategy succeeds → prefer it (true merge, preserves history).
 *   - If only apply-to-tip succeeds → offer "Apply to Tip" with a warning.
 *   - If both fail → show conflicts/errors from both.
 *   - If neither has a base commit → idle.
 *
 * The result includes all PackableObjects needed for the chosen strategy,
 * so when the user clicks the button we already have everything — no waiting.
 */

import { useEffect, useRef, useState } from "react";
import {
  buildPatchChainObjects,
  applyPatchChainToTip,
  type PatchChainBuildResult,
  type PatchChainApplyResult,
  type PatchChainBuildError,
  type MergeConflict,
} from "@/lib/patch-merge";
import type { CommitPerson } from "@/lib/git-objects";
import type { Patch } from "@/casts/Patch";
import type { GitGraspPool } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MergeabilityStatus =
  | "loading"
  | "ready"
  | "ready-apply-only"
  | "conflicts"
  | "error"
  | "idle";

export interface PatchMergeability {
  /** Current status of the mergeability check */
  status: MergeabilityStatus;
  /**
   * Pre-built objects for the merge strategy (blobs + trees + commits + merge commit).
   * Present when status is "ready".
   */
  buildResult: PatchChainBuildResult | null;
  /**
   * Pre-built objects for the apply-to-tip strategy (linear commits).
   * Present when status is "ready-apply-only".
   */
  applyResult: PatchChainApplyResult | null;
  /** File-level conflicts if status is "conflicts" */
  conflicts: MergeConflict[];
  /** Human-readable error message if status is "error" or "conflicts" */
  errorMessage: string | null;
  /**
   * Error/conflict details from the merge strategy (even when apply-to-tip succeeded).
   * Shown as context in the warning banner.
   */
  mergeStrategyError: string | null;
  /** Re-run the check (e.g. after HEAD changes) */
  recheck: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Eagerly check whether a patch chain can be merged or applied to the tip.
 *
 * @param patchChain            - The ordered patches (oldest first, cover letters excluded)
 * @param pool                  - GitGraspPool for fetching base tree / file content
 * @param fallbackUrls          - Extra clone URLs to try
 * @param enabled               - Set to false to skip the check entirely
 * @param guessedBaseCommitId   - Fallback base commit when the first patch has no
 *                                `parent-commit` tag (from the timestamp heuristic).
 * @param defaultBranchHead     - Current HEAD of the default branch (for apply-to-tip)
 * @param maintainerCommitter   - The maintainer's CommitPerson (for apply-to-tip commits)
 */
export function usePatchMergeability(
  patchChain: Patch[] | undefined,
  pool: GitGraspPool | null,
  fallbackUrls: string[] | undefined,
  enabled: boolean,
  guessedBaseCommitId?: string,
  defaultBranchHead?: string,
  maintainerCommitter?: CommitPerson,
): PatchMergeability {
  const [status, setStatus] = useState<MergeabilityStatus>("idle");
  const [buildResult, setBuildResult] = useState<PatchChainBuildResult | null>(
    null,
  );
  const [applyResult, setApplyResult] = useState<PatchChainApplyResult | null>(
    null,
  );
  const [conflicts, setConflicts] = useState<MergeConflict[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mergeStrategyError, setMergeStrategyError] = useState<string | null>(
    null,
  );
  const [recheckCounter, setRecheckCounter] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const recheck = () => setRecheckCounter((c) => c + 1);

  // Stable deps
  const tipCommitId = patchChain?.[patchChain.length - 1]?.commitId;
  const chainLength = patchChain?.length;

  useEffect(() => {
    // Reset state
    setBuildResult(null);
    setApplyResult(null);
    setConflicts([]);
    setErrorMessage(null);
    setMergeStrategyError(null);

    if (!enabled || !patchChain || patchChain.length === 0 || !pool) {
      setStatus("idle");
      return;
    }

    setStatus("loading");

    // Abort any previous run
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    // Capture narrowed references for use inside the async closure
    const chain = patchChain;
    const gitPool = pool;

    // Determine which strategies we can run
    const hasMergeBase = !!(chain[0].parentCommitId ?? guessedBaseCommitId);
    const hasApplyTarget = !!(defaultBranchHead && maintainerCommitter);

    // Run strategies sequentially: try merge first, only fall back to
    // apply-to-tip if merge fails. This avoids the extra git-server fetch
    // and patch-replay work when the merge strategy already succeeds.
    async function run() {
      // ── Strategy 1: merge against original base ──────────────────────
      let mergeRes: PatchChainBuildResult | PatchChainBuildError | null =
        hasMergeBase
          ? await buildPatchChainObjects(
              chain,
              gitPool,
              abort.signal,
              fallbackUrls,
              guessedBaseCommitId,
            )
          : null;

      if (abort.signal.aborted) return;

      const mergeOk = mergeRes !== null && !("reason" in mergeRes);

      if (mergeOk) {
        // Before declaring "ready", verify the base commit is actually an
        // ancestor of the default branch. If it isn't (e.g. the patch was
        // authored against a completely different codebase), the merge result
        // is meaningless — the patch applied against an unrelated tree.
        const baseCommitId = chain[0].parentCommitId ?? guessedBaseCommitId;
        let baseIsOnDefaultBranch = true; // optimistic when we can't check

        if (baseCommitId && defaultBranchHead) {
          const behind = await gitPool.countCommitsBehind(
            baseCommitId,
            abort.signal,
          );
          if (abort.signal.aborted) return;
          // countCommitsBehind returns null when the commit is not found in
          // the default branch history — i.e. no shared ancestor.
          baseIsOnDefaultBranch = behind !== null;
        }

        if (baseIsOnDefaultBranch) {
          // Merge strategy succeeded and base is on the default branch.
          setStatus("ready");
          setBuildResult(mergeRes as PatchChainBuildResult);
          setApplyResult(null);
          setConflicts([]);
          setErrorMessage(null);
          setMergeStrategyError(null);
          return;
        }

        // Base commit is not on the default branch — treat the merge strategy
        // result as a failure and fall through to apply-to-tip.
        mergeRes = {
          reason:
            "Patch base commit is not on the default branch — the patch was authored against a different codebase",
          conflicts: [],
        };
      }

      // ── Strategy 2: apply to tip (only if merge failed) ──────────────
      const applyRes: PatchChainApplyResult | PatchChainBuildError | null =
        hasApplyTarget && defaultBranchHead && maintainerCommitter
          ? await applyPatchChainToTip(
              chain,
              gitPool,
              defaultBranchHead,
              maintainerCommitter,
              abort.signal,
              fallbackUrls,
            )
          : null;

      if (abort.signal.aborted) return;

      const applyOk = applyRes !== null && !("reason" in applyRes);

      if (applyOk) {
        // Only apply-to-tip succeeded
        const mergeErr =
          mergeRes !== null && "reason" in mergeRes
            ? (mergeRes as { reason: string }).reason
            : hasMergeBase
              ? "Merge strategy failed"
              : "No merge base available";
        setStatus("ready-apply-only");
        setBuildResult(null);
        setApplyResult(applyRes as PatchChainApplyResult);
        setConflicts([]);
        setErrorMessage(null);
        setMergeStrategyError(mergeErr);
        return;
      }

      // Both failed — report the most informative error
      const mergeErr =
        mergeRes !== null && "reason" in mergeRes
          ? (mergeRes as { reason: string; conflicts: MergeConflict[] })
          : null;
      const applyErr =
        applyRes !== null && "reason" in applyRes
          ? (applyRes as { reason: string; conflicts: MergeConflict[] })
          : null;

      // Prefer whichever error has file-level conflict details; fall back to
      // merge strategy error for the human-readable message.
      const errWithConflicts =
        (applyErr?.conflicts?.length ?? 0) > 0
          ? applyErr
          : (mergeErr?.conflicts?.length ?? 0) > 0
            ? mergeErr
            : null;
      const primaryErr = errWithConflicts ?? mergeErr ?? applyErr;
      const primaryConflicts = errWithConflicts?.conflicts ?? [];

      if (primaryConflicts.length > 0) {
        setStatus("conflicts");
        setConflicts(primaryConflicts);
        setErrorMessage(primaryErr?.reason ?? "Conflicts detected");
      } else if (!hasMergeBase && !hasApplyTarget) {
        setStatus("idle");
      } else {
        setStatus("error");
        setErrorMessage(
          primaryErr?.reason ?? "Could not determine mergeability",
        );
      }
      setMergeStrategyError(null);
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
    chainLength,
    pool,
    recheckCounter,
    guessedBaseCommitId,
    defaultBranchHead,
    // maintainerCommitter intentionally excluded — it's derived from profile
    // which changes frequently; the committer identity doesn't affect whether
    // patches apply cleanly, only the resulting commit hash.
    // patchChain and fallbackUrls intentionally excluded — deps above are stable proxies
  ]);

  return {
    status,
    buildResult,
    applyResult,
    conflicts,
    errorMessage,
    mergeStrategyError,
    recheck,
  };
}
