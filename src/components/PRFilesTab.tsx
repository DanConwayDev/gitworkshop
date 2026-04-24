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
import type { NostrEvent } from "nostr-tools";
import type { InlineCommentMap } from "@/hooks/useInlineComments";

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
  /**
   * Extra URLs to try after the pool's own URLs if commit/blob data is not
   * found there. Not tracked by the pool. Populated from the PR event's and
   * latest PR Update's ["clone", ...] tags.
   */
  fallbackUrls?: string[];
  // ── Inline comment props ──────────────────────────────────────────────────
  /** Root PR event — enables inline code review comments when set */
  rootEvent?: NostrEvent;
  /** Immediate parent event for new comments (defaults to rootEvent) */
  parentEvent?: NostrEvent;
  /** Map of inline comments from useInlineComments() */
  commentMap?: InlineCommentMap;
  /** Commit ID to attach to new inline comments (tip commit) */
  commitId?: string;
  /** Repo coordinates for q-tags on new inline comments */
  repoCoords?: string[];
  /** Relay hint for NIP-22 tags */
  relayHint?: string;
}

export function PRFilesTab({
  tipCommitId,
  baseCommitId,
  pool,
  onFileCountChange,
  fallbackUrls,
  rootEvent,
  parentEvent,
  commentMap,
  commitId,
  repoCoords,
  relayHint,
}: PRFilesTabProps) {
  return (
    <CommitDiffView
      tipCommitId={tipCommitId}
      baseCommitId={baseCommitId}
      pool={pool}
      onFileCountChange={onFileCountChange}
      fallbackUrls={fallbackUrls}
      rootEvent={rootEvent}
      parentEvent={parentEvent}
      commentMap={commentMap}
      commitId={commitId}
      repoCoords={repoCoords}
      relayHint={relayHint}
    />
  );
}
