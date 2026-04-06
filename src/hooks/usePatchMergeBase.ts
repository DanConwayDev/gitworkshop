/**
 * usePatchMergeBase — resolve the base commit for a NIP-34 patch chain.
 *
 * Resolution order:
 *   1. `parent-commit` tag on the first patch (exact, authoritative).
 *   2. Timestamp heuristic: find the newest default-branch commit whose
 *      committer timestamp is ≤ the first patch's author timestamp.
 *      This approximates the commit the patch was based on when the
 *      `parent-commit` tag is absent (older ngit versions, manual patches).
 *   3. Default branch HEAD: if the timestamp heuristic fails (e.g. the repo
 *      history is too deep to walk), fall back to the tip of the default
 *      branch. Applying against HEAD is better than showing nothing — the
 *      patch apply logic will retry against HEAD anyway on hunk-mismatch.
 *
 * The heuristic is "good enough" for rendering the Files Changed diff and
 * for the merge-base check. It may be slightly off if the author committed
 * locally before pushing, but in practice the author timestamp closely
 * tracks when the patch was created relative to the upstream branch.
 *
 * Returns:
 *   - `baseCommitId`: the resolved commit hash, or undefined while computing
 *   - `isGuessed`: true when the heuristic was used (no parent-commit tag)
 *   - `computing`: true while the async lookup is in progress
 */

import { useState, useEffect, useRef } from "react";
import type { GitGraspPool, PoolState } from "@/lib/git-grasp-pool";
import type { Patch } from "@/casts/Patch";

// ---------------------------------------------------------------------------
// Timestamp extraction from a patch
// ---------------------------------------------------------------------------

/**
 * Extract the author timestamp (Unix seconds) from a patch.
 *
 * Priority:
 *   1. `author` tag: ["author", name, email, timestamp, tz]
 *   2. `Date:` header in the format-patch content
 *   3. Nostr event `created_at` as a last resort
 */
function extractPatchAuthorTimestamp(patch: Patch): number {
  // 1. Structured author tag
  const authorTag = patch.event.tags.find(([t]) => t === "author");
  if (authorTag) {
    const ts = parseInt(authorTag[3] ?? "", 10);
    if (!isNaN(ts) && ts > 0) return ts;
  }

  // 2. Date: header in format-patch content
  const dateMatch = patch.event.content.match(/^Date:\s*(.+)$/m);
  if (dateMatch) {
    const ts = Date.parse(dateMatch[1].trim());
    if (!isNaN(ts)) return Math.floor(ts / 1000);
  }

  // 3. Nostr event created_at
  return patch.event.created_at;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UsePatchMergeBaseResult {
  /** The resolved base commit hash, or undefined if not yet known. */
  baseCommitId: string | undefined;
  /**
   * True when the base was approximated via the timestamp heuristic
   * (no `parent-commit` tag was present on the first patch).
   */
  isGuessed: boolean;
  /** True while the async computation is in progress. */
  computing: boolean;
}

/**
 * Resolve the base commit for a NIP-34 patch chain.
 *
 * @param patchChain    - Ordered patches (oldest first, cover letters excluded).
 *                        Pass undefined or empty array to skip.
 * @param gitPool       - GitGraspPool for the repo (may be null while connecting).
 * @param poolState     - Reactive pool state (used to detect when infoRefs arrive).
 * @param fallbackUrls  - Extra clone URLs (e.g. PR author's fork).
 */
export function usePatchMergeBase(
  patchChain: Patch[] | undefined,
  gitPool: GitGraspPool | null,
  poolState: PoolState,
): UsePatchMergeBaseResult {
  const [baseCommitId, setBaseCommitId] = useState<string | undefined>(
    undefined,
  );
  const [isGuessed, setIsGuessed] = useState(false);
  const [computing, setComputing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Stable dep: first patch's ID (changes when the chain changes)
  const firstPatch = patchChain?.[0];
  const firstPatchId = firstPatch?.event.id;
  // Derive hasInfoRefs from poolState so the effect re-runs when infoRefs arrive.
  // poolState.winnerUrl changes when the pool connects, which is a reliable proxy.
  const hasInfoRefs = !!(poolState.winnerUrl && gitPool?.getInfoRefs());

  useEffect(() => {
    setBaseCommitId(undefined);
    setIsGuessed(false);

    if (!firstPatch || !firstPatchId) {
      setComputing(false);
      return;
    }

    // Case 1: parent-commit tag present — use it directly, no async needed.
    const parentCommitId = firstPatch.parentCommitId;
    if (parentCommitId) {
      setBaseCommitId(parentCommitId);
      setIsGuessed(false);
      setComputing(false);
      return;
    }

    // Case 2: no parent-commit tag — need the git pool + infoRefs for heuristic.
    if (!gitPool || !hasInfoRefs) {
      if (gitPool && !hasInfoRefs) {
        // Still waiting for infoRefs to arrive.
        setComputing(true);
      } else {
        setComputing(false);
      }
      return;
    }

    // Abort any previous in-flight computation.
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setComputing(true);

    const authorTimestamp = extractPatchAuthorTimestamp(firstPatch);

    gitPool
      .findCommitBeforeTimestamp(authorTimestamp, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;

        if (result) {
          setBaseCommitId(result);
          setIsGuessed(true);
          setComputing(false);
          return;
        }

        // Timestamp heuristic failed (history too deep or unreachable).
        // Fall back to the default branch HEAD so the patch apply logic has
        // something to work with — it will retry against HEAD on hunk-mismatch
        // anyway, so this just makes that the first attempt.
        const info = gitPool.getInfoRefs();
        const headRef = info?.symrefs["HEAD"];
        const headCommit = headRef
          ? info?.refs[headRef]
          : info
            ? Object.values(info.refs)[0]
            : undefined;

        setBaseCommitId(headCommit ?? undefined);
        setIsGuessed(true);
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
  }, [firstPatchId, gitPool, hasInfoRefs]);

  return { baseCommitId, isGuessed, computing };
}
