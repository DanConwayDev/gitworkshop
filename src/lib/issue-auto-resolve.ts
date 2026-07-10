/**
 * issue-auto-resolve — resolve issues from commit-message keywords at merge
 * time, mirroring ngit's push-time behaviour.
 *
 * ngit (`git-remote-nostr` push) scans the default-branch ref-update delta
 * (`oldRef..newTip`) for resolution keywords followed by issue references and
 * publishes a kind:1631 (resolved/applied) status event for each matching
 * issue. This module ports that parser, walk boundary, and event shape so
 * merging through the web UI is back-to-back compatible with merging via ngit:
 *
 *   - Verbs: close/closes/closed/closing, fix/fixes/fixed/fixing,
 *     resolve/resolves/resolved/resolving,
 *     implement/implements/implemented/implementing (case-insensitive,
 *     punctuation-trimmed, optional trailing ":").
 *   - References: 64-char hex event ids, `nevent1…` / `note1…` bech32
 *     (with or without a `nostr:` prefix), and `#<8-hex>` shorthands.
 *   - A `#<8-hex>` shorthand only matches when exactly one known issue id
 *     starts with the prefix — ambiguous prefixes are skipped.
 *   - Only the issue author or a repository maintainer may auto-resolve.
 *   - Issues already resolved or closed are skipped; each issue is resolved
 *     at most once per state-event default-branch update (youngest referencing
 *     commit wins).
 *   - Status content records the triggering phrase plus
 *     `resolved by commit <source>[, when merged in commit <merge>]`, and the
 *     event carries `r` tags for the source (and merge) commit alongside an
 *     `alt` tag of "issue resolved from commit message".
 *
 * Pure computation + factory signing — no React, no `@/services/nostr` — so
 * it is safe for both the production merge flow and the node e2e harness.
 */

import { nip19 } from "nostr-tools";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import { parseCommit, type Commit } from "@/lib/vendored/git-natural-api";
import type { PackableObject } from "@/lib/git-packfile";
import {
  StatusChangeFactory,
  STATUS_KIND_MAP,
} from "@/factories/StatusChangeFactory";
import type { IssueStatus } from "@/lib/nip34";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A parsed issue reference token from a commit message. */
export type IssueReferenceToken =
  | { type: "full"; id: string }
  | { type: "shorthand8"; prefix: string };

/** A resolution keyword + the references that followed it on the same line. */
export interface IssueResolutionMention {
  /** The normalised (lowercased, punctuation-trimmed) resolution verb. */
  verb: string;
  /** The full trimmed commit-message line the mention appeared on. */
  phrase: string;
  references: IssueReferenceToken[];
}

/** The minimal issue shape needed to match and authorise a resolution. */
export interface IssueCandidate {
  /** Hex event id of the kind:1621 issue. */
  id: string;
  /** Issue author pubkey. */
  pubkey: string;
  /** Current effective status — resolved/closed/deleted issues are skipped. */
  status: IssueStatus;
}

/** One issue to resolve, with the commit(s) that triggered it. */
export interface IssueResolution {
  issue: IssueCandidate;
  mention: IssueResolutionMention;
  /** The commit whose message referenced the issue. */
  sourceCommit: string;
  /**
   * The merge commit that landed `sourceCommit` on the default branch, when
   * it differs from the source commit itself.
   */
  mergeCommit?: string;
}

/** Minimal signer shape (matches `MergeSigner` structurally). */
interface ResolutionSigner {
  getPublicKey(): string | Promise<string>;
  signEvent(template: EventTemplate): NostrEvent | Promise<NostrEvent>;
}

// ---------------------------------------------------------------------------
// Commit-message parsing (port of ngit's extract_issue_resolution_mentions)
// ---------------------------------------------------------------------------

const RESOLUTION_VERBS = new Set([
  "close",
  "closes",
  "closed",
  "closing",
  "fix",
  "fixes",
  "fixed",
  "fixing",
  "resolve",
  "resolves",
  "resolved",
  "resolving",
  "implement",
  "implements",
  "implemented",
  "implementing",
]);

const VERB_TRIM = /^[\s,.;!?()[\]{}"']+|[\s,.;!?()[\]{}"']+$/g;
const TOKEN_TRIM = /^[\s,.:;!?()[\]{}<>"']+|[\s,.:;!?()[\]{}<>"']+$/g;
const HEX64 = /^[0-9a-f]{64}$/i;
const HEX8 = /^[0-9a-f]{8}$/i;

/** Normalise a word into a resolution verb, or return null. */
function normalizedResolutionVerb(word: string): string | null {
  const normalized = word
    .replace(VERB_TRIM, "")
    .replace(/:+$/, "")
    .toLowerCase();
  return RESOLUTION_VERBS.has(normalized) ? normalized : null;
}

/**
 * Parse a single token into a full hex event id, accepting 64-hex,
 * `nevent1…`, `note1…`, and `nostr:`-prefixed forms. Returns null for
 * anything else (npub/nprofile/naddr are NOT issue references).
 */
function parseEventIdToken(token: string): string | null {
  const candidate = token.startsWith("nostr:") ? token.slice(6) : token;

  try {
    const decoded = nip19.decode(candidate);
    if (decoded.type === "nevent") return decoded.data.id;
    if (decoded.type === "note") return decoded.data;
    return null;
  } catch {
    // not bech32 — fall through to hex
  }

  return HEX64.test(candidate) ? candidate.toLowerCase() : null;
}

/** Parse the words following a resolution verb into reference tokens. */
function parseIssueReferenceTokens(words: string[]): IssueReferenceToken[] {
  const refs: IssueReferenceToken[] = [];
  const seenFull = new Set<string>();
  const seenShort = new Set<string>();

  for (const raw of words) {
    const token = raw.replace(TOKEN_TRIM, "");
    if (!token) continue;

    if (token.startsWith("#")) {
      const short = token.slice(1);
      if (HEX8.test(short)) {
        const lowered = short.toLowerCase();
        if (!seenShort.has(lowered)) {
          seenShort.add(lowered);
          refs.push({ type: "shorthand8", prefix: lowered });
        }
        continue;
      }
    }

    const eventId = parseEventIdToken(token);
    if (eventId && !seenFull.has(eventId)) {
      seenFull.add(eventId);
      refs.push({ type: "full", id: eventId });
    }
  }

  return refs;
}

/**
 * Extract every resolution mention from a commit message. A mention is a
 * recognised verb followed (on the same line) by at least one issue
 * reference.
 */
export function extractIssueResolutionMentions(
  commitMessage: string,
): IssueResolutionMention[] {
  const mentions: IssueResolutionMention[] = [];

  for (const line of commitMessage.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const words = trimmedLine.split(/\s+/);
    for (let idx = 0; idx < words.length; idx++) {
      const verb = normalizedResolutionVerb(words[idx]);
      if (!verb) continue;
      const references = parseIssueReferenceTokens(words.slice(idx + 1));
      if (references.length === 0) continue;
      mentions.push({ verb, phrase: trimmedLine, references });
    }
  }

  return mentions;
}

// ---------------------------------------------------------------------------
// Reference resolution against known issues
// ---------------------------------------------------------------------------

/** Outcome of matching a reference against the repo's known issues. */
export type IssueReferenceResolution =
  | { outcome: "found"; issue: IssueCandidate }
  | { outcome: "not-found" }
  | { outcome: "ambiguous" };

/** Match a parsed reference against the repo's known issues. */
export function resolveIssueReference(
  reference: IssueReferenceToken,
  issues: IssueCandidate[],
): IssueReferenceResolution {
  if (reference.type === "full") {
    const issue = issues.find((i) => i.id === reference.id);
    return issue ? { outcome: "found", issue } : { outcome: "not-found" };
  }

  const matches = issues.filter((i) => i.id.startsWith(reference.prefix));
  if (matches.length === 1) return { outcome: "found", issue: matches[0] };
  return matches.length === 0
    ? { outcome: "not-found" }
    : { outcome: "ambiguous" };
}

// ---------------------------------------------------------------------------
// Commit graph helpers
// ---------------------------------------------------------------------------

/** Parse every commit-type object out of a packfile object set. */
export function parseCommitsFromPackableObjects(
  objects: PackableObject[],
): Commit[] {
  const commits: Commit[] = [];
  for (const obj of objects) {
    if (obj.type !== "commit") continue;
    try {
      commits.push(parseCommit(obj.data, obj.hash));
    } catch {
      // Malformed commit object — skip rather than abort the whole scan.
    }
  }
  return commits;
}

/**
 * Order commits youngest-first by walking parent edges from the new tip until
 * a previous ref value is reached (ngit parity: revwalk `oldRef..newTip`).
 * Commits that are present in the packfile but not reachable from `tipHash`
 * within this stop boundary are intentionally excluded: they did not land in
 * this kind:30618 state-event default-branch update.
 */
function orderCommitsYoungestFirst(
  commits: Commit[],
  tipHash: string,
  stopAtHashes: Set<string>,
) {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const ordered: Commit[] = [];
  const visited = new Set<string>();
  const queue = [tipHash];

  while (queue.length > 0) {
    const hash = queue.shift()!;
    if (visited.has(hash)) continue;
    visited.add(hash);
    if (stopAtHashes.has(hash)) continue;
    const commit = byHash.get(hash);
    if (!commit) continue;
    ordered.push(commit);
    queue.push(...commit.parents);
  }

  return { ordered, byHash };
}

/** Is `ancestorHash` reachable from `fromHash` via parent edges in the set? */
function isDescendantWithin(
  byHash: Map<string, Commit>,
  fromHash: string,
  ancestorHash: string,
): boolean {
  const stack = [fromHash];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const hash = stack.pop()!;
    if (hash === ancestorHash) return true;
    if (visited.has(hash)) continue;
    visited.add(hash);
    const commit = byHash.get(hash);
    if (commit) stack.push(...commit.parents);
  }
  return false;
}

/**
 * Find the merge commit that introduced `sourceCommit` in this push batch —
 * the oldest merge commit (youngest-first list, searched from the end) that
 * is a descendant of the source commit. Port of ngit's
 * `find_issue_merge_commit_for_source_commit`.
 */
function findMergeCommitForSourceCommit(
  byHash: Map<string, Commit>,
  mergeCommitsYoungestFirst: string[],
  sourceCommit: string,
): string | undefined {
  for (let i = mergeCommitsYoungestFirst.length - 1; i >= 0; i--) {
    const merge = mergeCommitsYoungestFirst[i];
    if (isDescendantWithin(byHash, merge, sourceCommit)) return merge;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Collection — which issues does this merge resolve?
// ---------------------------------------------------------------------------

/** Inputs for {@link collectIssueResolutions}. */
export interface CollectIssueResolutionsParams {
  /**
   * Commit objects available to inspect. The actual scan set is not this
   * whole array; it is the state-event default-branch ref delta obtained by
   * walking parents from `newTipHash` until `stopAtHashes`.
   */
  commits: Commit[];
  /** The new branch tip (the merge commit, or the last replayed commit). */
  newTipHash: string;
  /** Previous default-branch ref values that bound the `oldRef..newTip` walk. */
  stopAtHashes: Iterable<string>;
  /** The repo's known issues. */
  issues: IssueCandidate[];
  /** Pubkey of the maintainer performing the merge. */
  signerPubkey: string;
  /** Confirmed repository maintainers (authorisation set). */
  maintainers: string[];
  /** Optional diagnostics sink for skipped references. */
  warn?: (message: string) => void;
}

/**
 * Scan the commits introduced by the kind:30618 default-branch ref update for
 * resolution mentions and return the deduplicated set of issues to mark
 * resolved. The scan set mirrors ngit's revwalk of `oldRef..newTip`: commits
 * are visited youngest-first from the new tip and the walk stops before any
 * previous ref value in `stopAtHashes`.
 */
export function collectIssueResolutions(
  params: CollectIssueResolutionsParams,
): IssueResolution[] {
  const {
    commits,
    newTipHash,
    stopAtHashes,
    issues,
    signerPubkey,
    maintainers,
  } = params;
  const warn = params.warn ?? (() => undefined);
  if (commits.length === 0 || issues.length === 0) return [];

  const { ordered, byHash } = orderCommitsYoungestFirst(
    commits,
    newTipHash,
    new Set(stopAtHashes),
  );
  const mergeCommitsInPush = ordered
    .filter((c) => c.parents.length > 1)
    .map((c) => c.hash);

  const isMaintainer = maintainers.includes(signerPubkey);
  const resolutions: IssueResolution[] = [];
  const queuedIssueIds = new Set<string>();

  for (const commit of ordered) {
    const mentions = extractIssueResolutionMentions(commit.message);

    for (const mention of mentions) {
      for (const reference of mention.references) {
        const resolved = resolveIssueReference(reference, issues);
        if (resolved.outcome === "ambiguous") {
          warn(
            `commit ${commit.hash.slice(0, 7)}: issue reference is ambiguous in this repo, skipping`,
          );
          continue;
        }
        if (resolved.outcome === "not-found") continue;

        const issue = resolved.issue;
        if (queuedIssueIds.has(issue.id)) continue;

        // Match command-level permissions: only the issue author or a
        // repository maintainer can change issue status.
        if (issue.pubkey !== signerPubkey && !isMaintainer) {
          warn(
            `commit ${commit.hash.slice(0, 7)} references issue ${issue.id.slice(0, 8)}, but signer is not authorized to resolve it`,
          );
          continue;
        }

        // Skip issues that are already resolved, closed, or deleted.
        if (issue.status !== "open" && issue.status !== "draft") continue;

        const mergeCommit = findMergeCommitForSourceCommit(
          byHash,
          mergeCommitsInPush,
          commit.hash,
        );

        queuedIssueIds.add(issue.id);
        resolutions.push({
          issue,
          mention,
          sourceCommit: commit.hash,
          mergeCommit: mergeCommit === commit.hash ? undefined : mergeCommit,
        });
      }
    }
  }

  return resolutions;
}

// ---------------------------------------------------------------------------
// Status event creation
// ---------------------------------------------------------------------------

/**
 * Build the status content — the triggering phrase plus the commit linkage
 * suffix. Port of ngit's `create_issue_resolution_content`.
 */
export function createIssueResolutionContent(
  mention: IssueResolutionMention,
  sourceCommit: string,
  mergeCommit?: string,
): string {
  const basePhrase = mention.phrase.trim();
  const details = basePhrase === "" ? mention.verb : basePhrase;

  const suffix = mergeCommit
    ? `resolved by commit ${sourceCommit}, when merged in commit ${mergeCommit}`
    : `resolved by commit ${sourceCommit}`;

  return details === "" ? suffix : `${details}\n\n${suffix}`;
}

/**
 * Sign the kind:1631 resolved status for one auto-resolved issue. Shares
 * `StatusChangeFactory` with the manual status flow (root `e` tag, `a` tags
 * per coordinate, `p` notifications) and adds the ngit-specific `alt` and
 * commit `r` tags.
 */
export async function signIssueResolutionStatus(params: {
  signer: ResolutionSigner;
  signerPubkey: string;
  /** All repo coordinates ("30617:<pubkey>:<d>"). */
  repoCoords: string[];
  resolution: IssueResolution;
}): Promise<NostrEvent> {
  const { resolution } = params;
  const commitTags: string[][] = [["r", resolution.sourceCommit]];
  if (resolution.mergeCommit) {
    commitTags.push(["r", resolution.mergeCommit]);
  }

  return StatusChangeFactory.create(
    STATUS_KIND_MAP["resolved"],
    resolution.issue.id,
    params.repoCoords,
    resolution.issue.pubkey,
    params.signerPubkey,
  )
    .alt("issue resolved from commit message")
    .content(
      createIssueResolutionContent(
        resolution.mention,
        resolution.sourceCommit,
        resolution.mergeCommit,
      ),
    )
    .extraTags(commitTags)
    .sign(params.signer);
}
