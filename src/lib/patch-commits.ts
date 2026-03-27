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
 * When tags are missing (many NIP-34 tags are optional), we fall back to
 * parsing the git format-patch content in the event's content field:
 *   - `From:` header → author name + email
 *   - `Date:` header → author timestamp + timezone
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
export function formatTimezone(tzStr: string | undefined): string {
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
// Format-patch content fallback parsing
// ---------------------------------------------------------------------------

/**
 * Parse the `From:` header from a git format-patch string.
 * Format: `From: Name <email@example.com>`
 *
 * Returns { name, email } or undefined if not found.
 */
function parseFromHeader(
  content: string,
): { name: string; email: string } | undefined {
  const match = content.match(/^From:\s*(.+?)\s*<([^>]+)>/m);
  if (match) return { name: match[1].trim(), email: match[2] };

  // Some patches have just an email: `From: email@example.com`
  const emailOnly = content.match(/^From:\s*(\S+@\S+)/m);
  if (emailOnly) return { name: emailOnly[1], email: emailOnly[1] };

  return undefined;
}

/**
 * Parse the `Date:` header from a git format-patch string.
 * Format: `Date: Thu, 24 Oct 2024 14:30:00 +0100`
 *
 * Returns { timestamp, timezone } or undefined if not found/parseable.
 */
function parseDateHeader(
  content: string,
): { timestamp: number; timezone: string } | undefined {
  const match = content.match(/^Date:\s*(.+)$/m);
  if (!match) return undefined;

  const dateStr = match[1].trim();

  // Extract timezone from the end: "+0100", "-0500", "+0000"
  const tzMatch = dateStr.match(/([+-]\d{4})\s*$/);
  const timezone = tzMatch ? tzMatch[1] : "+0000";

  // Parse the date string
  const ts = Date.parse(dateStr);
  if (isNaN(ts)) return undefined;

  return { timestamp: Math.floor(ts / 1000), timezone };
}

/**
 * Build a PersonInfo by parsing the format-patch content headers.
 * Used as a fallback when author/committer tags are missing.
 */
function parsePersonFromContent(content: string): PersonInfo | undefined {
  const from = parseFromHeader(content);
  if (!from) return undefined;

  const date = parseDateHeader(content);

  return {
    name: from.name,
    email: from.email,
    timestamp: date?.timestamp ?? Math.floor(Date.now() / 1000),
    timezone: date?.timezone ?? "+0000",
  };
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
// GPG signature extraction
// ---------------------------------------------------------------------------

/**
 * Extract the GPG signature from a patch event's `commit-pgp-sig` tag.
 * Returns the raw signature string or undefined if absent.
 */
function extractGpgSignature(patch: Patch): string | undefined {
  const tag = patch.event.tags.find(([t]) => t === "commit-pgp-sig");
  if (!tag || !tag[1]) return undefined;
  return tag[1];
}

// ---------------------------------------------------------------------------
// Synthetic Commit construction
// ---------------------------------------------------------------------------

/** Placeholder tree hash — we don't rebuild trees, just need a valid-looking hash */
const PLACEHOLDER_TREE_HASH = "0000000000000000000000000000000000000000";

/**
 * Build a synthetic `Commit` object from a NIP-34 patch event.
 *
 * Extraction priority for author/committer:
 *   1. Structured tags (["author", ...] / ["committer", ...])
 *   2. Format-patch content headers (From: / Date:)
 *   3. Event metadata (pubkey, created_at)
 *
 * Returns a Commit even when the commit ID tag is missing — in that case
 * the hash is set to a placeholder. The caller decides whether to use it.
 */
export function buildSyntheticCommit(patch: Patch): Commit | null {
  const commitId = patch.commitId;
  if (!commitId) return null;

  const author = parsePersonTag(patch, "author");
  const committer = parsePersonTag(patch, "committer");

  // Fallback: parse from format-patch content headers
  const contentPerson = !author
    ? parsePersonFromContent(patch.content)
    : undefined;

  // Last resort: use event metadata
  const fallbackPerson: PersonInfo = {
    name: "(unknown)",
    email: "",
    timestamp: patch.event.created_at,
    timezone: "+0000",
  };

  const effectiveAuthor = author ?? contentPerson ?? fallbackPerson;
  const effectiveCommitter =
    committer ?? author ?? contentPerson ?? fallbackPerson;

  const parents: string[] = [];
  const parentCommitId = patch.parentCommitId;
  if (parentCommitId) parents.push(parentCommitId);

  return {
    hash: commitId,
    tree: PLACEHOLDER_TREE_HASH,
    parents,
    author: effectiveAuthor,
    committer: effectiveCommitter,
    message: extractCommitMessage(patch),
  };
}

/**
 * Build a synthetic Commit even when the commit ID tag is missing.
 * Uses the Nostr event ID as a placeholder hash. Useful for rendering
 * the commit detail page when no git commit hash is available.
 */
export function buildSyntheticCommitFallback(patch: Patch): Commit {
  const fromTags = buildSyntheticCommit(patch);
  if (fromTags) return fromTags;

  // No commit ID — use event ID as placeholder
  const author = parsePersonTag(patch, "author");
  const contentPerson = !author
    ? parsePersonFromContent(patch.content)
    : undefined;
  const fallbackPerson: PersonInfo = {
    name: "(unknown)",
    email: "",
    timestamp: patch.event.created_at,
    timezone: "+0000",
  };

  const effectiveAuthor = author ?? contentPerson ?? fallbackPerson;
  const committer = parsePersonTag(patch, "committer");
  const effectiveCommitter =
    committer ?? author ?? contentPerson ?? fallbackPerson;

  const parents: string[] = [];
  const parentCommitId = patch.parentCommitId;
  if (parentCommitId) parents.push(parentCommitId);

  return {
    hash: patch.event.id, // Nostr event ID as placeholder
    tree: PLACEHOLDER_TREE_HASH,
    parents,
    author: effectiveAuthor,
    committer: effectiveCommitter,
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

/**
 * Extract the GPG signature from a patch event, if present.
 * Re-exported for use by verification code.
 */
export { extractGpgSignature };
