/**
 * patch-commits — build synthetic git Commit objects from NIP-34 patch events.
 *
 * NIP-34 patches (kind:1617) carry structured tags with git commit metadata:
 *   ["commit",        "<commit-hash>"]
 *   ["parent-commit", "<parent-hash>"]
 *   ["author",        "<name>", "<email>", "<timestamp>", "<tz-offset>"]
 *   ["committer",     "<name>", "<email>", "<timestamp>", "<tz-offset>"]
 *
 * This module extracts that metadata and constructs `Commit` objects (matching
 * the type from @fiatjaf/git-natural-api) that can be injected into the
 * GitGraspPool cache. This makes `pool.getSingleCommit()` return the right
 * data for patch-sourced commits, enabling the commit detail page to render
 * without needing the git server to have these commits.
 *
 * The tree hash is set to a placeholder — we don't rebuild full git trees
 * here. The commit detail page uses the patch's embedded diff directly
 * instead of tree-based diffing.
 */

import type { Commit } from "@fiatjaf/git-natural-api";
import type { Patch } from "@/casts/Patch";

// ---------------------------------------------------------------------------
// Tag parsing helpers
// ---------------------------------------------------------------------------

interface PersonInfo {
  name: string;
  email: string;
  timestamp: number;
  timezone: string;
}

/**
 * Parse an author or committer tag from a patch event.
 * Format: ["author"|"committer", "<name>", "<email>", "<timestamp>", "<tz-offset>"]
 *
 * The timezone offset in the tag is a raw number (e.g. "0", "60", "-300")
 * representing minutes offset from UTC. We convert to git's "+HHMM" format.
 */
function parsePersonTag(patch: Patch, tagName: string): PersonInfo | undefined {
  const tag = patch.event.tags.find(([t]) => t === tagName);
  if (!tag) return undefined;
  const [, name, email, tsStr, tzStr] = tag;
  if (!name || !tsStr) return undefined;
  const timestamp = parseInt(tsStr, 10);
  if (isNaN(timestamp)) return undefined;

  // Convert timezone offset to git format
  const timezone = formatTimezone(tzStr);

  return { name, email: email ?? "", timestamp, timezone };
}

/**
 * Convert a timezone offset string to git's "+HHMM" format.
 *
 * ngit stores the offset as a plain number string. The interpretation varies:
 *   - "0"     → "+0000"
 *   - "+0100" → "+0100" (already in git format)
 *   - "60"    → "+0100" (minutes offset)
 *   - "-300"  → "-0500" (minutes offset)
 *
 * We detect the format by checking if it already contains "+" or "-" followed
 * by 4 digits (git format), otherwise treat as minutes.
 */
function formatTimezone(tzStr: string | undefined): string {
  if (!tzStr) return "+0000";

  // Already in git format? e.g. "+0100", "-0500"
  if (/^[+-]\d{4}$/.test(tzStr)) return tzStr;

  // Numeric minutes offset
  const minutes = parseInt(tzStr, 10);
  if (isNaN(minutes)) return "+0000";

  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Commit message extraction
// ---------------------------------------------------------------------------

/**
 * Extract the full commit message from a patch.
 * Prefers the description tag, falls back to parsing the format-patch content.
 */
function extractCommitMessage(patch: Patch): string {
  // The Patch cast already has subject and body parsed
  const subject = patch.subject;
  const body = patch.body;
  if (body) return `${subject}\n\n${body}`;
  return subject;
}

// ---------------------------------------------------------------------------
// Synthetic Commit construction
// ---------------------------------------------------------------------------

/** Placeholder tree hash — we don't rebuild trees, just need a valid-looking hash */
const PLACEHOLDER_TREE_HASH = "0000000000000000000000000000000000000000";

/**
 * Build a synthetic `Commit` object from a NIP-34 patch event.
 *
 * Returns null if the patch doesn't have a commit ID tag (can't be
 * meaningfully cached without a hash).
 */
export function buildSyntheticCommit(patch: Patch): Commit | null {
  const commitId = patch.commitId;
  if (!commitId) return null;

  const author = parsePersonTag(patch, "author");
  const committer = parsePersonTag(patch, "committer");

  // Fall back to event metadata if tags are missing
  const fallbackPerson: PersonInfo = {
    name: "(unknown)",
    email: "",
    timestamp: patch.event.created_at,
    timezone: "+0000",
  };

  const parents: string[] = [];
  const parentCommitId = patch.parentCommitId;
  if (parentCommitId) parents.push(parentCommitId);

  return {
    hash: commitId,
    tree: PLACEHOLDER_TREE_HASH,
    parents,
    author: author ?? fallbackPerson,
    committer: committer ?? author ?? fallbackPerson,
    message: extractCommitMessage(patch),
  };
}

/**
 * Build synthetic Commit objects for an entire patch chain and return them
 * as a Map keyed by commit hash.
 *
 * Patches without a commit ID tag are skipped.
 */
export function buildSyntheticCommits(chain: Patch[]): Map<string, Commit> {
  const commits = new Map<string, Commit>();
  for (const patch of chain) {
    const commit = buildSyntheticCommit(patch);
    if (commit) {
      commits.set(commit.hash, commit);
    }
  }
  return commits;
}

/**
 * Build synthetic commits from a patch chain and inject them into a
 * GitGraspPool's cache so that `pool.getSingleCommit()` returns them.
 *
 * This is idempotent — calling it multiple times with the same chain
 * just overwrites the same cache entries.
 */
export function injectPatchCommitsIntoCache(
  chain: Patch[],
  cache: { putCommit(commit: Commit): void },
): Map<string, Commit> {
  const commits = buildSyntheticCommits(chain);
  for (const commit of commits.values()) {
    cache.putCommit(commit);
  }
  return commits;
}
