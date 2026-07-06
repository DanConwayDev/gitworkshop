/**
 * useDetectedMergeCommit — best-effort "already merged?" detection for a
 * PR/patch that is still open but may have been merged outside the app (e.g.
 * `ngit merge` locally) without the kind:1631 merged status ever publishing.
 *
 * Wraps `findDetectedNgitMergeCommitInHistory` from git-grasp-pool with the
 * React lifecycle: scans when enabled, aborts on dependency changes, resets
 * the user-requested extra look-back whenever the item or branch head
 * changes, and exposes a `lookBackFurther()` action for the capped-scan UI.
 */

import { useState, useEffect, useCallback } from "react";
import {
  findDetectedNgitMergeCommitInHistory,
  DETECTED_MERGE_HISTORY_MAX_WITHOUT_BASE,
  DETECTED_MERGE_HISTORY_MAX_WITH_BASE,
  DETECTED_MERGE_HISTORY_LOOKBACK_STEP,
  type DetectedMergeCommit,
  type DetectedMergeScanResult,
  type GitGraspPool,
} from "@/lib/git-grasp-pool";

interface UseDetectedMergeCommitParams {
  /** Pool for the repo. Scanning is skipped while null. */
  gitPool: GitGraspPool | null;
  /** Current HEAD of the default branch. Scanning is skipped while unset. */
  defaultBranchHead: string | undefined;
  /** The PR/patch root event id the merge commit must reference. */
  rootEventId: string;
  /** Extra clone URLs passed through to the pool fetches. */
  fallbackUrls: string[];
  /** Master switch — scan only while true (e.g. item open, not mid-merge). */
  enabled: boolean;
  /** The item's tip commit; a detected merge must list it as a parent. */
  tipCommitId?: string;
  /** The item's stated base — bounds the scan when known. */
  stopAtCommitId?: string;
}

interface UseDetectedMergeCommitResult {
  /** The detected merge commit, or null. */
  detectedMergeCommit: DetectedMergeCommit | null;
  /** Full scan outcome (hit limit, scanned count, …), or null. */
  scanResult: DetectedMergeScanResult | null;
  /** True while a scan is in flight. */
  detecting: boolean;
  /** Extend the scan cap by one look-back step and re-scan. */
  lookBackFurther: () => void;
  /** How many extra commits each look-back step adds. */
  lookbackStep: number;
}

export function useDetectedMergeCommit(
  params: UseDetectedMergeCommitParams,
): UseDetectedMergeCommitResult {
  const {
    gitPool,
    defaultBranchHead,
    rootEventId,
    fallbackUrls,
    enabled,
    tipCommitId,
    stopAtCommitId,
  } = params;

  const [detectedMergeCommit, setDetectedMergeCommit] =
    useState<DetectedMergeCommit | null>(null);
  const [scanResult, setScanResult] = useState<DetectedMergeScanResult | null>(
    null,
  );
  const [detecting, setDetecting] = useState(false);
  const [extraLookback, setExtraLookback] = useState(0);

  const baseLimit = stopAtCommitId
    ? DETECTED_MERGE_HISTORY_MAX_WITH_BASE
    : DETECTED_MERGE_HISTORY_MAX_WITHOUT_BASE;
  const scanLimit = baseLimit + extraLookback;

  // Reset the opt-in look-back when the item or branch context changes.
  useEffect(() => {
    setExtraLookback(0);
  }, [rootEventId, defaultBranchHead, tipCommitId, stopAtCommitId]);

  useEffect(() => {
    setDetectedMergeCommit(null);
    setScanResult(null);

    if (!gitPool || !defaultBranchHead || !enabled) {
      setDetecting(false);
      return;
    }

    const abort = new AbortController();
    setDetecting(true);

    findDetectedNgitMergeCommitInHistory(
      gitPool,
      defaultBranchHead,
      rootEventId,
      abort.signal,
      fallbackUrls,
      scanLimit,
      tipCommitId,
      stopAtCommitId,
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        setDetectedMergeCommit(result.commit);
        setScanResult(result);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setDetectedMergeCommit(null);
          setScanResult(null);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setDetecting(false);
      });

    return () => abort.abort();
  }, [
    gitPool,
    defaultBranchHead,
    fallbackUrls,
    enabled,
    rootEventId,
    tipCommitId,
    stopAtCommitId,
    scanLimit,
  ]);

  const lookBackFurther = useCallback(() => {
    setExtraLookback((n) => n + DETECTED_MERGE_HISTORY_LOOKBACK_STEP);
  }, []);

  return {
    detectedMergeCommit,
    scanResult,
    detecting,
    lookBackFurther,
    lookbackStep: DETECTED_MERGE_HISTORY_LOOKBACK_STEP,
  };
}
