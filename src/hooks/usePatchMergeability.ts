/**
 * usePatchMergeability — eagerly checks whether a patch chain can be merged.
 *
 * Runs buildPatchChainObjects on mount (and when deps change) to determine
 * if the patch chain applies cleanly against the current default branch HEAD.
 * The result includes all PackableObjects needed for the merge, so when the
 * user clicks "Merge" we already have everything — no waiting.
 *
 * The merge commit itself is NOT created here (its timestamp should be "now"
 * at click time). Only the patch chain objects are pre-built.
 */

import { useEffect, useRef, useState } from "react";
import {
  buildPatchChainObjects,
  type PatchChainBuildResult,
  type MergeConflict,
} from "@/lib/patch-merge";
import type { Patch } from "@/casts/Patch";
import type { GitGraspPool } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MergeabilityStatus =
  | "loading"
  | "ready"
  | "conflicts"
  | "error"
  | "idle";

export interface PatchMergeability {
  /** Current status of the mergeability check */
  status: MergeabilityStatus;
  /** The pre-built objects (blobs + trees + commits), ready for packfile */
  buildResult: PatchChainBuildResult | null;
  /** File-level conflicts if status is "conflicts" */
  conflicts: MergeConflict[];
  /** Human-readable error message if status is "error" */
  errorMessage: string | null;
  /** Re-run the check (e.g. after HEAD changes) */
  recheck: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Eagerly check whether a patch chain can be merged.
 *
 * @param patchChain    - The ordered patches (oldest first, cover letters excluded)
 * @param pool          - GitGraspPool for fetching base tree / file content
 * @param fallbackUrls  - Extra clone URLs to try
 * @param enabled       - Set to false to skip the check entirely
 */
export function usePatchMergeability(
  patchChain: Patch[] | undefined,
  pool: GitGraspPool | null,
  fallbackUrls: string[] | undefined,
  enabled: boolean,
): PatchMergeability {
  const [status, setStatus] = useState<MergeabilityStatus>("idle");
  const [buildResult, setBuildResult] = useState<PatchChainBuildResult | null>(
    null,
  );
  const [conflicts, setConflicts] = useState<MergeConflict[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recheckCounter, setRecheckCounter] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const recheck = () => setRecheckCounter((c) => c + 1);

  // Stable dep: tip commit ID of the last patch in the chain
  const tipCommitId = patchChain?.[patchChain.length - 1]?.commitId;
  const chainLength = patchChain?.length;

  useEffect(() => {
    // Reset state
    setBuildResult(null);
    setConflicts([]);
    setErrorMessage(null);

    if (!enabled || !patchChain || patchChain.length === 0 || !pool) {
      setStatus("idle");
      return;
    }

    setStatus("loading");

    // Abort any previous run
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    buildPatchChainObjects(patchChain, pool, abort.signal, fallbackUrls)
      .then((result) => {
        if (abort.signal.aborted) return;

        if ("reason" in result) {
          // Error or conflicts
          if (result.conflicts.length > 0) {
            setStatus("conflicts");
            setConflicts(result.conflicts);
            setErrorMessage(result.reason);
          } else {
            setStatus("error");
            setErrorMessage(result.reason);
          }
        } else {
          // Success
          setStatus("ready");
          setBuildResult(result);
        }
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        setStatus("error");
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Unknown error during merge check",
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
    // patchChain and fallbackUrls intentionally excluded — deps above are stable proxies
  ]);

  return {
    status,
    buildResult,
    conflicts,
    errorMessage,
    recheck,
  };
}
