/**
 * git-grasp-pool — already-merged detection.
 *
 * Best-effort scan of the default branch history for an ngit-style merge
 * commit that references a PR/patch root event whose merged status event is
 * missing (e.g. the maintainer merged locally with `ngit merge` but the
 * kind:1631 never propagated). A hit lets the UI offer "mark as merged"
 * (publish the missing status) instead of a second, conflicting merge.
 *
 * A commit counts as a detected merge when it has 2+ parents and either its
 * subject matches ngit's `Merge #<id8>:` convention or its message contains a
 * `nostr:nevent1...` line that decodes to the root event id. When the item's
 * tip commit is known, the merge commit must also list it as a parent.
 */

import { nip19 } from "nostr-tools";
import type { GitGraspPool } from "./pool";
import type { Commit } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Commit-history batch size. Matches git-grasp-pool's default merge-base/count
 * batch size so this usually reuses history already fetched for PR mergeability
 * and behind-count checks.
 */
const DETECTED_MERGE_HISTORY_BATCH_SIZE = 200;

/** Default cap when no explicit base bounds the search. */
export const DETECTED_MERGE_HISTORY_MAX_WITHOUT_BASE = 500;

/** Default cap when an explicit base lets us safely walk deeper. */
export const DETECTED_MERGE_HISTORY_MAX_WITH_BASE = 1000;

/** Extra commits scanned each time the user opts into a deeper look-back. */
export const DETECTED_MERGE_HISTORY_LOOKBACK_STEP = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A merge commit detected on the default branch for a PR/patch. */
export interface DetectedMergeCommit {
  hash: string;
  subject: string;
}

/** Outcome of a history scan for a detected merge commit. */
export interface DetectedMergeScanResult {
  commit: DetectedMergeCommit | null;
  scannedCount: number;
  reachedStopCommit: boolean;
  reachedHistoryRoot: boolean;
  hitLimit: boolean;
  maxTotal: number;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function firstCommitSubject(message: string): string {
  return message.split("\n", 1)[0]?.trim() ?? "";
}

function messageReferencesRootEvent(
  message: string,
  rootEventId: string,
): boolean {
  const re = /nostr:(nevent1[023456789acdefghjklmnpqrstuvwxyz]+)/g;
  for (const match of message.matchAll(re)) {
    const nevent = match[1];
    if (!nevent) continue;
    try {
      const decoded = nip19.decode(nevent);
      if (decoded.type === "nevent" && decoded.data.id === rootEventId) {
        return true;
      }
    } catch {
      // Ignore malformed nostr: lines in arbitrary commit messages.
    }
  }
  return false;
}

/** Find an ngit-style merge commit for the root event within a commit batch. */
export function findDetectedNgitMergeCommit(
  commits: Commit[],
  rootEventId: string,
  tipCommitId?: string,
): DetectedMergeCommit | null {
  const mergeSubjectPrefix = `Merge #${rootEventId.slice(0, 8)}:`;

  for (const commit of commits) {
    if (commit.parents.length < 2) continue;
    if (tipCommitId && !commit.parents.includes(tipCommitId)) continue;

    const subject = firstCommitSubject(commit.message);
    const referencesRoot =
      subject.startsWith(mergeSubjectPrefix) ||
      messageReferencesRootEvent(commit.message, rootEventId);

    if (referencesRoot) {
      return { hash: commit.hash, subject };
    }
  }

  return null;
}

/**
 * Walk the default branch history (in batches, via the pool) looking for an
 * ngit-style merge commit that references the root event. Stops at
 * `stopAtCommitHash` (the item's stated base) when provided, at the history
 * root, or after `maxTotal` commits.
 */
export async function findDetectedNgitMergeCommitInHistory(
  gitPool: GitGraspPool,
  defaultBranchHead: string,
  rootEventId: string,
  signal: AbortSignal,
  fallbackUrls: string[],
  maxTotal: number,
  tipCommitId?: string,
  stopAtCommitHash?: string,
): Promise<DetectedMergeScanResult> {
  let offset = 0;
  let batchStart = defaultBranchHead;

  while (offset < maxTotal) {
    if (signal.aborted) {
      return {
        commit: null,
        scannedCount: offset,
        reachedStopCommit: false,
        reachedHistoryRoot: false,
        hitLimit: false,
        maxTotal,
      };
    }

    const remaining = maxTotal - offset;
    const batchSize = Math.min(DETECTED_MERGE_HISTORY_BATCH_SIZE, remaining);
    const batch = await gitPool.getCommitHistory(
      batchStart,
      batchSize,
      signal,
      fallbackUrls,
    );

    if (!batch || batch.length === 0 || signal.aborted) {
      return {
        commit: null,
        scannedCount: offset,
        reachedStopCommit: false,
        reachedHistoryRoot: false,
        hitLimit: false,
        maxTotal,
      };
    }

    const stopIdx = stopAtCommitHash
      ? batch.findIndex((commit) => commit.hash === stopAtCommitHash)
      : -1;
    const searchableBatch =
      stopIdx === -1 ? batch : batch.slice(0, stopIdx + 1);
    const scannedCount = offset + searchableBatch.length;
    const detected = findDetectedNgitMergeCommit(
      searchableBatch,
      rootEventId,
      tipCommitId,
    );
    if (detected) {
      return {
        commit: detected,
        scannedCount,
        reachedStopCommit: stopIdx !== -1,
        reachedHistoryRoot: false,
        hitLimit: false,
        maxTotal,
      };
    }

    if (stopIdx !== -1) {
      return {
        commit: null,
        scannedCount,
        reachedStopCommit: true,
        reachedHistoryRoot: false,
        hitLimit: false,
        maxTotal,
      };
    }

    offset += batch.length;

    const tail = batch[batch.length - 1];
    if (tail.parents.length === 0) {
      return {
        commit: null,
        scannedCount: offset,
        reachedStopCommit: false,
        reachedHistoryRoot: true,
        hitLimit: false,
        maxTotal,
      };
    }
    batchStart = tail.parents[0];
  }

  return {
    commit: null,
    scannedCount: offset,
    reachedStopCommit: false,
    reachedHistoryRoot: false,
    hitLimit: true,
    maxTotal,
  };
}
