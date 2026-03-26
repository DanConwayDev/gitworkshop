/**
 * usePRMergeBase — derive the merge base for a PR when the merge-base tag
 * is absent from the PR event.
 *
 * The merge-base tag is optional in NIP-34. When it is missing we walk the
 * commit chain to find the common ancestor with the default branch. The hook
 * also re-runs whenever the tip commit changes (e.g. after a PR rebase).
 *
 * Returns:
 *   - `mergeBase`: the resolved commit hash, or undefined while computing
 *   - `computing`: true while the async lookup is in progress
 */

import { useState, useEffect, useRef } from "react";
import type { GitGraspPool, PoolState } from "@/lib/git-grasp-pool";

export interface UsePRMergeBaseResult {
  /** The resolved merge-base commit hash, or undefined if not yet known. */
  mergeBase: string | undefined;
  /** True while the async computation is in progress. */
  computing: boolean;
}

/**
 * Derive the merge base for a PR.
 *
 * If `explicitMergeBase` is provided it is returned immediately (no git
 * operations are performed). Otherwise the hook walks the commit chain via
 * `gitPool.findMergeBase()`.
 *
 * The computation re-runs whenever `tipCommitId` changes so that PR updates
 * (rebases) are handled correctly.
 *
 * @param gitPool           - The git pool for the repo (may be null while connecting).
 * @param poolState         - Reactive pool state (used to detect when infoRefs arrive).
 * @param tipCommitId       - The PR's tip commit (may be undefined while loading).
 * @param explicitMergeBase - The merge-base from the PR event tag, if present.
 * @param fallbackUrls      - Extra clone URLs (e.g. PR author's fork).
 */
export function usePRMergeBase(
  gitPool: GitGraspPool | null,
  poolState: PoolState,
  tipCommitId: string | undefined,
  explicitMergeBase: string | undefined,
  fallbackUrls?: string[],
): UsePRMergeBaseResult {
  const [derived, setDerived] = useState<string | undefined>(undefined);
  const [computing, setComputing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Track the last tip+pool combination we ran for so we don't re-run
  // unnecessarily when unrelated state changes.
  const lastRunKeyRef = useRef<string>("");

  // Whether infoRefs are available (needed before we can call findMergeBase).
  const hasInfoRefs = gitPool ? !!gitPool.getInfoRefs() : false;

  useEffect(() => {
    // If an explicit merge base is provided, nothing to do.
    if (explicitMergeBase !== undefined) {
      setDerived(undefined);
      setComputing(false);
      abortRef.current?.abort();
      return;
    }

    // Need a pool with infoRefs and a tip commit to proceed.
    if (!gitPool || !hasInfoRefs || !tipCommitId) {
      // If we're still waiting for data, show computing state.
      if (tipCommitId && gitPool && !hasInfoRefs) {
        setComputing(true);
      }
      return;
    }

    const runKey = `${tipCommitId}:${fallbackUrls?.join(",") ?? ""}`;
    if (runKey === lastRunKeyRef.current) return;
    lastRunKeyRef.current = runKey;

    // Abort any previous in-flight computation.
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setComputing(true);
    setDerived(undefined);

    gitPool
      .findMergeBase(tipCommitId, abort.signal, fallbackUrls)
      .then((result) => {
        if (abort.signal.aborted) return;
        setDerived(result ?? undefined);
        setComputing(false);
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        setComputing(false);
      });

    return () => {
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gitPool,
    hasInfoRefs,
    tipCommitId,
    explicitMergeBase,
    fallbackUrls?.join(","),
  ]);

  // If an explicit merge base is provided, use it directly.
  if (explicitMergeBase !== undefined) {
    return { mergeBase: explicitMergeBase, computing: false };
  }

  return { mergeBase: derived, computing };
}
