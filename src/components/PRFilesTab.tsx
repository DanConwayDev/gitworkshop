/**
 * PRFilesTab — "Files Changed" view for a PR.
 *
 * Delegates all diff loading and rendering to CommitDiffView.
 *
 * The PR event (kind 1618) carries:
 *   ["c",          "<tip-commit-id>"]   — head of the PR branch
 *   ["merge-base", "<base-commit-id>"]  — common ancestor with target branch
 *   ["clone",      "<url>", ...]        — git servers hosting the PR commits
 *
 * If merge-base is absent we fall back to the repo's HEAD commit from the
 * pool state (best-effort).
 */

import { CommitDiffView } from "@/components/CommitDiffView";
import type { GitGraspPool } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PRFilesTabProps {
  /** Tip commit ID from the PR event's ["c", ...] tag. */
  tipCommitId: string;
  /** Base commit ID — from ["merge-base", ...] or repo HEAD. */
  baseCommitId: string;
  /** Pool instance from useGitPool (repo clone URLs). */
  pool: GitGraspPool;
  /** Called whenever the number of changed files becomes known. */
  onFileCountChange?: (count: number) => void;
}

export function PRFilesTab({
  tipCommitId,
  baseCommitId,
  pool,
  onFileCountChange,
}: PRFilesTabProps) {
  return (
    <CommitDiffView
      tipCommitId={tipCommitId}
      baseCommitId={baseCommitId}
      pool={pool}
      onFileCountChange={onFileCountChange}
    />
  );
}
