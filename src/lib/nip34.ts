/**
 * NIP-34 Git Stuff - Constants and helpers
 */

import type { NostrEvent } from "nostr-tools";
import {
  getNip10References,
  getCommentRootPointer,
} from "applesauce-common/helpers";
import {
  getReplaceableIdentifier,
  getOrComputeCachedValue,
} from "applesauce-core/helpers";
import { ISSUE_LABEL_NAMESPACE } from "@/blueprints/label";

// ---------------------------------------------------------------------------
// Patch-chain identification tags — excluded from user-visible labels
// ---------------------------------------------------------------------------

/**
 * `t` tag values that are used internally for patch chain identification
 * (NIP-34) and must be excluded from user-visible label lists.
 */
export const PATCH_CHAIN_TAGS = new Set([
  "revision-root",
  "root-revision",
  "root",
  "cover-letter",
]);

// ---------------------------------------------------------------------------
// Patch message parsing (ported from gitworkshop)
// ---------------------------------------------------------------------------

/**
 * Extract the commit message from a git format-patch string.
 * Returns subject + optional body separated by a blank line.
 */
export function extractPatchMessage(s: string): string | undefined {
  try {
    const subjectMatch = s.match(/^Subject: \[PATCH[^\]]*\] (.*)$/m);
    if (!subjectMatch) return undefined;

    const subjectLineEnd = (subjectMatch.index ?? 0) + subjectMatch[0].length;
    const remaining = s.substring(subjectLineEnd);

    let subject = subjectMatch[1];
    const lines = remaining.split("\n");
    let bodyStartIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      if (i === 0 && lines[i] === "") {
        bodyStartIndex = i + 1;
        break;
      } else if (lines[i].startsWith(" ")) {
        subject += "\n" + lines[i].substring(1);
        bodyStartIndex = i + 1;
      } else if (lines[i] === "") {
        bodyStartIndex = i + 1;
        break;
      } else {
        bodyStartIndex = i;
        break;
      }
    }

    const bodyLines = lines.slice(bodyStartIndex);
    let message = subject;
    let messageEndIndex = bodyLines.length;

    for (let i = 0; i < bodyLines.length; i++) {
      const line = bodyLines[i];
      if (line.match(/^ .+ \| \d+/)) {
        messageEndIndex = i;
        break;
      }
      if (line.startsWith("diff --git ")) {
        messageEndIndex = i;
        break;
      }
    }

    if (messageEndIndex > 0) {
      let bodyText = bodyLines.slice(0, messageEndIndex).join("\n").trim();
      if (bodyText === "---" || bodyText.endsWith("\n---")) {
        bodyText = bodyText.replace(/\n?---$/, "").trim();
      }
      if (bodyText) message += "\n\n" + bodyText;
    }

    return message;
  } catch {
    return undefined;
  }
}

/**
 * Extract the unified diff portion from a git format-patch string.
 * Returns everything from the first `diff --git` line onwards, or an empty
 * string if no diff section is found.
 */
export function extractPatchDiff(s: string): string {
  const idx = s.indexOf("diff --git ");
  if (idx === -1) return "";
  return s.substring(idx).trimEnd();
}

/** First line of a string. */
export function firstLine(s: string): string {
  return s.split(/\r?\n/)[0];
}

/** Everything after the first line of a string, trimmed. */
export function remainingLines(s: string): string {
  const idx = s.indexOf("\n");
  if (idx === -1) return "";
  return s.substring(idx).trim();
}

/**
 * Extract the subject (title) for a patch event.
 * Uses the first line of the `description` tag, falling back to
 * parsing the patch content via extractPatchMessage.
 */
export function extractPatchSubject(ev: NostrEvent): string {
  const desc = ev.tags.find(([t]) => t === "description")?.[1];
  if (desc) return firstLine(desc);
  const fromContent = extractPatchMessage(ev.content);
  if (fromContent) return firstLine(fromContent);
  return "(untitled)";
}

/**
 * Extract the body for a patch event.
 * Uses lines 2+ of the `description` tag, falling back to parsing
 * the patch content via extractPatchMessage.
 */
export function extractPatchBody(ev: NostrEvent): string {
  const desc = ev.tags.find(([t]) => t === "description")?.[1];
  if (desc) return remainingLines(desc);
  const fromContent = extractPatchMessage(ev.content);
  if (fromContent) return remainingLines(fromContent);
  return "";
}

/** Repository announcement (addressable, kind 30617) */
export const REPO_KIND = 30617;

/** Repository state announcement (addressable, kind 30618) */
export const REPO_STATE_KIND = 30618;

/** Git issue (kind 1621) */
export const ISSUE_KIND = 1621;

/** Git patch — root patch of a patch set (kind 1617) */
export const PATCH_KIND = 1617;

/** Git pull request (kind 1618) */
export const PR_KIND = 1618;

/** Git pull request update — changes the tip of a referenced PR (kind 1619) */
export const PR_UPDATE_KIND = 1619;

/** Root kinds that appear in the PRs list (patches + PRs). */
export const PR_ROOT_KINDS = [PATCH_KIND, PR_KIND] as const;

/** NIP-22 comment (kind 1111) */
export const COMMENT_KIND = 1111;

/** Status kinds */
export const STATUS_OPEN = 1630;
export const STATUS_RESOLVED = 1631;
export const STATUS_CLOSED = 1632;
export const STATUS_DRAFT = 1633;

/** NIP-32 label event kind */
export const LABEL_KIND = 1985;

/** NIP-09 deletion request kind */
export const DELETION_KIND = 5;

/** NIP-32 label namespace used for subject-rename events */
export const SUBJECT_LABEL_NAMESPACE = "#subject";

export const STATUS_KINDS = [
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_DRAFT,
] as const;

export type IssueStatus = "open" | "resolved" | "closed" | "draft" | "deleted";

export function kindToStatus(kind: number): IssueStatus {
  switch (kind) {
    case STATUS_OPEN:
      return "open";
    case STATUS_RESOLVED:
      return "resolved";
    case STATUS_CLOSED:
      return "closed";
    case STATUS_DRAFT:
      return "draft";
    default:
      return "open";
  }
}

// ---------------------------------------------------------------------------
// Cached per-event tag extractors for kind:30617 announcement events
//
// Each function uses getOrComputeCachedValue to attach the result to the raw
// NostrEvent object via a symbol key. Because the EventStore reuses the same
// event object reference across reactive updates, the parse runs at most once
// per event version regardless of how many times resolveChain, cast classes,
// or models call these helpers.
// ---------------------------------------------------------------------------

const RepoNameSymbol = Symbol.for("repo-ev-name");
const RepoDescriptionSymbol = Symbol.for("repo-ev-description");
const RepoCloneUrlsSymbol = Symbol.for("repo-ev-clone-urls");
const RepoWebUrlsSymbol = Symbol.for("repo-ev-web-urls");
const RepoRelaysSymbol = Symbol.for("repo-ev-relays");
const RepoMaintainersSymbol = Symbol.for("repo-ev-maintainers");

/** Extract the human-readable name from a kind:30617 event. Falls back to the d-tag. */
export function getRepoName(ev: NostrEvent): string {
  return getOrComputeCachedValue(
    ev,
    RepoNameSymbol,
    () =>
      ev.tags.find(([t]) => t === "name")?.[1] ??
      ev.tags.find(([t]) => t === "d")?.[1] ??
      "",
  );
}

/** Extract the description from a kind:30617 event. Falls back to content. */
export function getRepoDescription(ev: NostrEvent): string {
  return getOrComputeCachedValue(
    ev,
    RepoDescriptionSymbol,
    () => ev.tags.find(([t]) => t === "description")?.[1] ?? ev.content ?? "",
  );
}

/**
 * Extract all clone URLs from a kind:30617 event.
 * NIP-34 packs multiple URLs as extra elements of a single tag:
 *   ["clone", "url1", "url2", ...]
 */
export function getRepoCloneUrls(ev: NostrEvent): string[] {
  return getOrComputeCachedValue(ev, RepoCloneUrlsSymbol, () =>
    ev.tags
      .filter(([t]) => t === "clone")
      .flatMap(([, ...urls]) => urls.filter(Boolean)),
  );
}

/**
 * Returns true if the URL is a Grasp server clone URL.
 *
 * A Grasp clone URL has the form:
 *   https://<domain>/<npub1...>/<repo-name>.git
 *
 * Ported from the Rust implementation in ngit (src/lib/repo_ref.rs).
 */
export function isGraspCloneUrl(url: string): boolean {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  if (!url.endsWith(".git") && !url.endsWith(".git/")) return false;

  // Extract npub1... substring
  const npubStart = url.indexOf("npub1");
  if (npubStart === -1) return false;
  let npubEnd = npubStart + 5;
  while (npubEnd < url.length && /[0-9a-z]/.test(url[npubEnd])) npubEnd++;
  const npub = url.slice(npubStart, npubEnd);
  if (npub.length < 10) return false; // sanity: too short to be a real npub

  // Must have format: /{npub}/<repo-name>.git
  const npubPattern = `/${npub}/`;
  const npubPos = url.indexOf(npubPattern);
  if (npubPos === -1) return false;

  const afterNpub = url.slice(npubPos + npubPattern.length).replace(/\/$/, "");
  if (!afterNpub || afterNpub === ".git") return false;
  if (!afterNpub.endsWith(".git")) return false;

  const repoName = afterNpub.slice(0, -4); // strip .git
  return repoName.length > 0;
}

/**
 * Extract the domain (hostname) from a Grasp clone URL.
 * Returns undefined if the URL is not a valid Grasp clone URL or cannot be parsed.
 */
export function graspCloneUrlDomain(url: string): string | undefined {
  if (!isGraspCloneUrl(url)) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Extract the npub from a Grasp clone URL.
 * Grasp URLs have the form: https://<domain>/<npub1...>/<repo-name>.git
 * Returns undefined if the URL is not a valid Grasp clone URL.
 */
export function graspCloneUrlNpub(url: string): string | undefined {
  if (!isGraspCloneUrl(url)) return undefined;
  const npubStart = url.indexOf("npub1");
  if (npubStart === -1) return undefined;
  let npubEnd = npubStart + 5;
  while (npubEnd < url.length && /[0-9a-z]/.test(url[npubEnd])) npubEnd++;
  const npub = url.slice(npubStart, npubEnd);
  return npub.length >= 10 ? npub : undefined;
}

/**
 * Extract all web URLs from a kind:30617 event.
 * Same multi-value tag format as clone: ["web", "url1", "url2", ...]
 */
export function getRepoWebUrls(ev: NostrEvent): string[] {
  return getOrComputeCachedValue(ev, RepoWebUrlsSymbol, () =>
    ev.tags
      .filter(([t]) => t === "web")
      .flatMap(([, ...urls]) => urls.filter(Boolean)),
  );
}

/**
 * Extract all relay URLs from a kind:30617 event.
 * NIP-34 packs multiple relay URLs as extra elements of a single tag:
 *   ["relays", "wss://relay1", "wss://relay2", ...]
 */
export function getRepoRelays(ev: NostrEvent): string[] {
  return getOrComputeCachedValue(ev, RepoRelaysSymbol, () =>
    ev.tags
      .filter(([t]) => t === "relays")
      .flatMap(([, ...urls]) => urls.filter(Boolean)),
  );
}

/**
 * Extract the list of co-maintainer pubkeys from a kind:30617 event.
 * Format: ["maintainers", "pubkey1", "pubkey2", ...]
 * Returns an empty array when the tag is absent.
 */
export function getRepoMaintainers(ev: NostrEvent): string[] {
  return getOrComputeCachedValue(ev, RepoMaintainersSymbol, () => {
    const tag = ev.tags.find(([t]) => t === "maintainers");
    return tag ? tag.slice(1).filter(Boolean) : [];
  });
}

// ---------------------------------------------------------------------------
// Cached per-event tag extractors for kind:30618 state events
// ---------------------------------------------------------------------------

const StateRefsSymbol = Symbol.for("repo-state-ev-refs");
const StateHeadSymbol = Symbol.for("repo-state-ev-head");

/**
 * A single ref entry from a kind:30618 state event.
 * `name` is the full ref path, e.g. "refs/heads/main".
 * `commitId` is the full commit hash.
 * `parentCommitIds` are the optional shorthand parent/grandparent commit IDs
 * used to identify how many commits ahead a ref is.
 */
export interface RepoStateRef {
  name: string;
  commitId: string;
  parentCommitIds: string[];
}

/**
 * Extract all refs from a kind:30618 state event.
 * Format: ["refs/<heads|tags>/<name>", "<commit-id>", "<parent>", ...]
 *
 * For annotated tags the state event may include both the tag object entry
 * and a peeled entry (name + "^{}") that holds the actual commit hash.
 * We use the peeled commit hash when available so comparisons against git
 * infoRefs (which we also peel) stay consistent.
 */
export function getStateRefs(ev: NostrEvent): RepoStateRef[] {
  return getOrComputeCachedValue(ev, StateRefsSymbol, () => {
    // Build a map of peeled commit hashes: "refs/tags/v1.0.0" → "abc123..."
    const peeled = new Map<string, string>();
    for (const [name, commitId] of ev.tags) {
      if (name?.endsWith("^{}") && commitId) {
        peeled.set(name.slice(0, -3), commitId);
      }
    }

    return ev.tags
      .filter(([t]) => t?.startsWith("refs/") && !t.endsWith("^{}"))
      .map(([name, commitId, ...parents]) => ({
        name,
        // Prefer the peeled commit hash for annotated tags
        commitId: peeled.get(name) ?? commitId ?? "",
        parentCommitIds: parents.filter(Boolean),
      }))
      .filter((r) => r.commitId);
  });
}

/**
 * Extract the HEAD ref from a kind:30618 state event.
 * Format: ["HEAD", "ref: refs/heads/<branch-name>"]
 * Returns the full ref path (e.g. "refs/heads/main") or undefined.
 */
export function getStateHead(ev: NostrEvent): string | undefined {
  return getOrComputeCachedValue(ev, StateHeadSymbol, () => {
    const tag = ev.tags.find(([t]) => t === "HEAD");
    if (!tag) return undefined;
    const val = tag[1] ?? "";
    // Format: "ref: refs/heads/<branch>"
    const match = val.match(/^ref:\s*(.+)$/);
    return match ? match[1] : undefined;
  });
}

/**
 * Get the commit ID for the HEAD branch from a kind:30618 state event.
 * Returns undefined if HEAD or the target ref is missing.
 */
export function getStateHeadCommit(ev: NostrEvent): string | undefined {
  const headRef = getStateHead(ev);
  if (!headRef) return undefined;
  const refs = getStateRefs(ev);
  return refs.find((r) => r.name === headRef)?.commitId;
}

/**
 * Default git nostr index relay. Any relay operator can run their own index;
 * this is just the well-known default used to seed the user-configurable
 * gitIndexRelays setting.
 */
export const DEFAULT_GIT_INDEX_RELAY = "wss://index.ngit.dev";

/**
 * Options controlling which relays are queried for repo-specific events
 * (issues, comments, status, zaps). Announcement events (kind 30617) are
 * always fetched from gitIndexRelays regardless of these options.
 *
 * relayHints: extra relays to query in addition to the repo's declared relays.
 *   Defaults to [] (empty). Populated from naddr URL relay hints or per-repo
 *   settings. gitIndexRelays is NOT included by default — add it here explicitly
 *   if you want issues from the discovery relay.
 *
 * useItemAuthorRelays: when true, also query the NIP-65 outbox relays of the
 *   issue author for comments and zaps. Defaults to false — no existing
 *   behaviour changes when this is omitted or false. Leave off on list pages
 *   (RepoPage) to avoid per-item relay churn; enable on detail pages
 *   (IssuePage) where completeness matters.
 *
 * maintainerPubkeys: the full list of maintainer pubkeys from
 *   ResolvedRepo.maintainerSet. Required when useItemAuthorRelays is true so
 *   that outbox relays can be fetched for issues and status queries. Ignored
 *   when useItemAuthorRelays is false.
 */
export interface RepoQueryOptions {
  relayHints: string[];
  useItemAuthorRelays?: boolean;
  maintainerPubkeys?: string[];
}

/**
 * Build an naddr-style coordinate string for a repo.
 * Format: "30617:<pubkey>:<d-tag>"
 */
export function repoCoordinate(pubkey: string, dTag: string): string {
  return `${REPO_KIND}:${pubkey}:${dTag}`;
}

/**
 * Extract the pubkey from a NIP-34 coordinate string.
 * Format: "<kind>:<pubkey>:<d-tag>"
 * Returns undefined if the coordinate is malformed.
 */
export function pubkeyFromCoordinate(coord: string): string | undefined {
  const parts = coord.split(":");
  // Minimum: kind + pubkey + d-tag (d-tag may itself contain colons)
  if (parts.length < 3) return undefined;
  const pubkey = parts[1];
  // Pubkey must be a 64-char hex string
  return /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : undefined;
}

/**
 * Derive a stable, sorted cache key from an array of repo coordinate strings.
 * Sorting ensures that the same set of coords in a different order produces
 * the same key, avoiding duplicate model instances.
 */
export function coordsCacheKey(coords: string[]): string {
  return [...coords].sort().join(",");
}

// ---------------------------------------------------------------------------
// ResolvedRepo — the merged view of a multi-maintainer repository
// ---------------------------------------------------------------------------

/** Provenance record: which maintainer contributed a value and when */
export interface FieldProvenance {
  pubkey: string;
  createdAt: number;
  value: string;
}

/** An edge in the maintainer graph: `from` listed `to` as a maintainer */
export interface MaintainerEdge {
  from: string;
  to: string;
}

/**
 * The fully-resolved view of a repository after BFS chain resolution.
 *
 * Display fields (name, description, webUrls) use latest-wins across all
 * maintainer announcements. Infrastructure fields (cloneUrls, relays) are
 * unioned. The raw announcements and provenance data are preserved for the
 * detailed maintainership graph view.
 */
export interface ResolvedRepo {
  // --- Identity ---
  /** The pubkey used as the starting point for resolution (route anchor) */
  selectedMaintainer: string;
  /** The d-tag identifier shared by all announcements in this repo */
  dTag: string;

  // --- Merged display fields (latest-wins) ---
  name: string;
  description: string;
  /** Web URLs from the single latest announcement */
  webUrls: string[];
  /** Timestamp of the latest announcement (for display) */
  updatedAt: number;

  // --- Unioned infrastructure fields ---
  /** All clone URLs across all maintainer announcements, deduplicated */
  cloneUrls: string[];
  /** Subset of cloneUrls that are Grasp server clone URLs */
  graspCloneUrls: string[];
  /** Subset of cloneUrls that are NOT Grasp server clone URLs */
  additionalGitServerUrls: string[];
  /** Unique Grasp server domains (hostnames) derived from graspCloneUrls */
  graspServerDomains: string[];
  /** All relay URLs across all maintainer announcements, deduplicated */
  relays: string[];

  // --- Maintainer set ---
  /**
   * Confirmed maintainers: pubkeys that have published their own announcement
   * for this dTag AND whose announcement lists at least one already-confirmed
   * maintainer (mutual acknowledgment). The selectedMaintainer is always
   * confirmed. This is the safe set to display publicly — it cannot be
   * inflated by a bad actor simply listing a reputable pubkey.
   */
  maintainerSet: string[];
  /**
   * "30617:<pubkey>:<dTag>" for every confirmed maintainer — used for #a tag
   * queries on issues, PRs, and patches.
   */
  allCoordinates: string[];
  /**
   * Pubkeys that are not confirmed maintainers. Covers two cases:
   *   1. Listed by someone in the confirmed set but have no announcement at all.
   *   2. Have an announcement for this dTag but don't list any confirmed
   *      maintainer back (no reciprocation) — the reputation-hijack vector.
   * Neither case should be displayed in repo cards.
   */
  requestedMaintainers: string[];
  /** Union of `t` tags across all announcements (excluding "personal-fork") */
  labels: string[];

  // --- Graph / provenance data (for detailed view) ---
  /** Raw announcement events, one per maintainer that has published one */
  announcements: NostrEvent[];
  /** Directed edges: who listed whom in their maintainers tag */
  maintainerEdges: MaintainerEdge[];
  /** Per-URL provenance for clone URLs */
  cloneUrlProvenance: FieldProvenance[];
  /** Per-URL provenance for relay URLs */
  relayProvenance: FieldProvenance[];
  /** Which announcement's name won (latest created_at) */
  nameSource: FieldProvenance;
  /** Which announcement's description won */
  descriptionSource: FieldProvenance;
}

// ---------------------------------------------------------------------------
// ResolvedIssueLite — lightweight summary for list pages
// ---------------------------------------------------------------------------

/**
 * The fully-resolved view of an issue after merging the raw issue event with
 * its status, label, and subject-rename events.
 *
 * Mirrors the ResolvedRepo pattern: a single entity combining information from
 * multiple Nostr events so consumers can filter and display without holding
 * separate maps.
 *
 * `status` is the single source of truth for deletion — a valid NIP-09
 * deletion request sets status to "deleted", which takes precedence over any
 * status event.
 *
 * For the full detail-page view (with comments, zaps, timeline nodes, etc.),
 * see `ResolvedIssue` which extends this interface.
 */
export interface ResolvedIssueLite {
  /** The raw issue event ID */
  id: string;
  /** The issue author's pubkey */
  pubkey: string;
  /** The raw issue event — for consumers that need fields not in the flat interface */
  event: NostrEvent;
  /** Original subject from the issue event itself */
  originalSubject: string;
  /**
   * Current (effective) subject — the latest authorised rename, or
   * originalSubject when no renames exist.
   */
  currentSubject: string;
  /** Issue body */
  content: string;
  /** Unix timestamp (seconds) of the root issue event */
  createdAt: number;
  /**
   * Unix timestamp (seconds) of the most recent activity — the latest of the
   * root event, any comment, or any status/label event. Used for sorting lists
   * by "most recently active".
   */
  lastActivityAt: number;
  /**
   * Current status. "deleted" takes precedence over all other status events
   * when a valid NIP-09 deletion request exists.
   */
  status: IssueStatus;
  /**
   * Deduplicated labels from both the issue's own `t` tags and NIP-32
   * kind:1985 label events, sorted alphabetically.
   */
  labels: string[];
  /** All repository coordinates from `#a` tags, sorted */
  repoCoords: string[];
  /**
   * Number of NIP-22 comments (kind:1111). Zero until useNip34ItemLoader
   * (tier: "comments" or "thread") has fetched comment events into the store.
   */
  commentCount: number;
  /**
   * Number of unique commenter pubkeys (including the issue author).
   * Zero until useNip34ItemLoader has fetched comment events into the store.
   */
  participantCount: number;
  /**
   * Number of zap receipts (kind:9735). Zero until useNip34ItemLoader
   * (tier: "thread") has fetched zap events into the store.
   */
  zapCount: number;
  /**
   * The set of pubkeys authorised to write status, label, and subject-rename
   * events for this issue. Includes the issue author and all maintainers.
   *
   * Convenience property so consumers (e.g. edit buttons) can check
   * authorisation without independently reconstructing the maintainer set.
   */
  authorisedUsers: Set<string>;
}

// ---------------------------------------------------------------------------
// Subject / body extraction
// ---------------------------------------------------------------------------

/**
 * Extract the original subject from a root event.
 *
 * Different NIP-34 kinds store the subject in different tags:
 * - Issues (1621) and PRs (1618): `subject` tag
 * - Patches (1617): first line of `description` tag, falling back to content parsing
 *
 * This function is the single source of truth for subject extraction from
 * raw events. The cast classes (Issue, PR, Patch) mirror this logic.
 */
export function extractSubject(ev: NostrEvent): string {
  if (ev.kind === PATCH_KIND) return extractPatchSubject(ev);
  return ev.tags.find(([t]) => t === "subject")?.[1] ?? "(untitled)";
}

/**
 * Extract the body/description from a root event.
 *
 * - Issues (1621) and PRs (1618): `content` field
 * - Patches (1617): lines 2+ of `description` tag, falling back to content parsing
 */
export function extractBody(ev: NostrEvent): string {
  if (ev.kind === PATCH_KIND) return extractPatchBody(ev);
  return ev.content;
}

/**
 * Options that vary between entity types when building resolved lists.
 *
 * mergeStatusRequiresMaintainer: when true, the merge-specific status kinds
 *   (resolved/closed) require the author to be a maintainer — the item author
 *   alone is not sufficient. Used for patches and PRs where only maintainers
 *   can mark something as merged. Default: false (issue behaviour).
 *
 * prUpdateEvents: kind:1619 PR Update events to factor into lastActivityAt.
 *   These are keyed by their `E` (uppercase) root pointer to the original PR.
 *   Only used for PRs — ignored for issues.
 */
export interface ResolveEssentialsOptions {
  mergeStatusRequiresMaintainer?: boolean;
  prUpdateEvents?: NostrEvent[];
}

/**
 * Build a fully-resolved list of items from raw root events and their
 * associated essentials, comments, and zaps. Single pass over each input
 * array — no intermediate Maps escape this function.
 *
 * Auth rules:
 * - Deletion (kind:5): only the root event author is valid (NIP-09).
 * - Status events: root author and maintainers are authorised.
 *   When mergeStatusRequiresMaintainer is true, only maintainers may set
 *   resolved/closed status (for patches/PRs).
 * - Label events: root author and maintainers are authorised.
 * Deletion takes precedence over all status events.
 *
 * The returned list is sorted descending by lastActivityAt (max of root
 * created_at, latest comment, latest essential event).
 */
function buildResolvedList(
  rootEvents: NostrEvent[],
  essentialEvents: NostrEvent[],
  commentEvents: NostrEvent[],
  zapEvents: NostrEvent[],
  maintainerSet: Set<string>,
  options: ResolveEssentialsOptions = {},
): (ResolvedIssueLite & { itemType?: PRItemType })[] {
  const { mergeStatusRequiresMaintainer = false, prUpdateEvents } = options;

  // ── Index root events ────────────────────────────────────────────────────
  const authorById = new Map<string, string>();
  const subjectById = new Map<string, string>();
  const tLabelsById = new Map<string, string[]>();
  for (const ev of rootEvents) {
    authorById.set(ev.id, ev.pubkey);
    subjectById.set(ev.id, extractSubject(ev));
    tLabelsById.set(
      ev.id,
      ev.tags
        .filter(([t, v]) => t === "t" && !PATCH_CHAIN_TAGS.has(v))
        .map(([, v]) => v),
    );
  }

  // ── Process essentials (single pass) ────────────────────────────────────
  const deletedIds = new Set<string>();
  const latestStatusByRoot = new Map<
    string,
    { kind: number; createdAt: number }
  >();
  const labelsByRoot = new Map<string, Set<string>>();
  const renamesByRoot = new Map<
    string,
    { createdAt: number; id: string; value: string }[]
  >();
  const latestEssentialAt = new Map<string, number>();

  for (const ev of essentialEvents) {
    const rootId = getNip10References(ev).root?.e?.id;
    if (!rootId || !authorById.has(rootId)) continue;

    // Track latest essential timestamp for lastActivityAt.
    const prev = latestEssentialAt.get(rootId) ?? 0;
    if (ev.created_at > prev) latestEssentialAt.set(rootId, ev.created_at);

    const issuePubkey = authorById.get(rootId)!;
    const isMaintainer = maintainerSet.has(ev.pubkey);
    const isAuthor = ev.pubkey === issuePubkey;

    // ── Deletion (kind:5) — NIP-09: only the original author's deletion is valid.
    if (ev.kind === DELETION_KIND) {
      if (isAuthor) deletedIds.add(rootId);
      continue;
    }

    // ── Status events (kinds 1630–1633)
    if ((STATUS_KINDS as readonly number[]).includes(ev.kind)) {
      const statusRootId = getNip10References(ev).root?.e?.id;
      if (!statusRootId || !authorById.has(statusRootId)) continue;

      const isMergeStatus =
        ev.kind === STATUS_RESOLVED || ev.kind === STATUS_CLOSED;
      if (mergeStatusRequiresMaintainer && isMergeStatus) {
        if (!isMaintainer) continue;
      } else {
        if (!isAuthor && !isMaintainer) continue;
      }

      const existing = latestStatusByRoot.get(statusRootId);
      if (!existing || ev.created_at > existing.createdAt) {
        latestStatusByRoot.set(statusRootId, {
          kind: ev.kind,
          createdAt: ev.created_at,
        });
      }
      continue;
    }

    // ── Label events (kind:1985)
    if (ev.kind === LABEL_KIND) {
      if (!isAuthor && !isMaintainer) continue;

      const subjectLabel = ev.tags.find(
        ([t, , ns]) => t === "l" && ns === SUBJECT_LABEL_NAMESPACE,
      );
      if (subjectLabel) {
        const existing = renamesByRoot.get(rootId) ?? [];
        existing.push({
          createdAt: ev.created_at,
          id: ev.id,
          value: subjectLabel[1],
        });
        renamesByRoot.set(rootId, existing);
      }

      for (const [t, label, ns] of ev.tags) {
        if (t === "l" && ns === ISSUE_LABEL_NAMESPACE && label) {
          const set = labelsByRoot.get(rootId) ?? new Set<string>();
          set.add(label);
          labelsByRoot.set(rootId, set);
        }
      }
    }
  }

  // ── Index comments and zaps ──────────────────────────────────────────────
  const commentsByRoot = new Map<string, NostrEvent[]>();
  for (const ev of commentEvents) {
    const rootPointer = getCommentRootPointer(ev);
    const rootId =
      rootPointer && "id" in rootPointer ? rootPointer.id : undefined;
    if (!rootId) continue;
    const existing = commentsByRoot.get(rootId) ?? [];
    existing.push(ev);
    commentsByRoot.set(rootId, existing);
  }

  const zapsByRoot = new Map<string, number>();
  for (const ev of zapEvents) {
    const rootId = getNip10References(ev).root?.e?.id;
    if (!rootId) continue;
    zapsByRoot.set(rootId, (zapsByRoot.get(rootId) ?? 0) + 1);
  }

  // ── Index PR Update events (kind:1619) for lastActivityAt ────────────────
  // PR Updates use ["E", "<pr-id>"] (uppercase, NIP-22 root pointer).
  // Auth: only the PR author or a maintainer may push a PR Update.
  // We don't enforce auth here — the timestamp is used only for sorting, so
  // an unauthorised update at most bumps the sort order, not the displayed tip.
  const latestPRUpdateAt = new Map<string, number>();
  if (prUpdateEvents) {
    for (const ev of prUpdateEvents) {
      const rootId = ev.tags.find(([t]) => t === "E")?.[1];
      if (!rootId || !authorById.has(rootId)) continue;
      const prev = latestPRUpdateAt.get(rootId) ?? 0;
      if (ev.created_at > prev) latestPRUpdateAt.set(rootId, ev.created_at);
    }
  }

  // ── Build resolved items ─────────────────────────────────────────────────
  return rootEvents
    .map((ev) => {
      const originalSubject = extractSubject(ev);

      // Derive status, labels, currentSubject from accumulated data.
      let status: IssueStatus;
      if (deletedIds.has(ev.id)) {
        status = "deleted";
      } else {
        const latestStatus = latestStatusByRoot.get(ev.id);
        status = latestStatus ? kindToStatus(latestStatus.kind) : "open";
      }

      const tLabels = tLabelsById.get(ev.id) ?? [];
      const nip32Labels = Array.from(labelsByRoot.get(ev.id) ?? []);
      const labels = Array.from(new Set([...tLabels, ...nip32Labels])).sort();

      const renames = (renamesByRoot.get(ev.id) ?? []).sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      );
      const currentSubject =
        renames.length > 0
          ? renames[renames.length - 1].value
          : originalSubject;

      const comments = commentsByRoot.get(ev.id) ?? [];
      const participantPubkeys = new Set(comments.map((c) => c.pubkey));

      const authorisedUsers = new Set(maintainerSet);
      authorisedUsers.add(ev.pubkey);

      const latestCommentAt = comments.reduce(
        (max, c) => Math.max(max, c.created_at),
        0,
      );
      const lastActivityAt = Math.max(
        ev.created_at,
        latestCommentAt,
        latestEssentialAt.get(ev.id) ?? 0,
        latestPRUpdateAt.get(ev.id) ?? 0,
      );

      return {
        id: ev.id,
        pubkey: ev.pubkey,
        event: ev,
        originalSubject,
        currentSubject,
        content: extractBody(ev),
        createdAt: ev.created_at,
        lastActivityAt,
        status,
        labels,
        repoCoords: ev.tags
          .filter(([t]) => t === "a")
          .map(([, v]) => v)
          .sort(),
        commentCount: comments.length,
        participantCount: participantPubkeys.size,
        zapCount: zapsByRoot.get(ev.id) ?? 0,
        authorisedUsers,
      };
    })
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/**
 * Build a sorted list of ResolvedIssueLite objects from raw events. Pure function,
 * no side effects. Comment/zap counts are 0 until useNip34ItemLoader (tier:
 * "thread") fetches them into the store.
 */
export function buildResolvedIssues(
  rootEvents: NostrEvent[],
  essentialEvents: NostrEvent[],
  commentEvents: NostrEvent[],
  zapEvents: NostrEvent[],
  maintainerSet: Set<string>,
  options: ResolveEssentialsOptions = {},
): ResolvedIssueLite[] {
  return buildResolvedList(
    rootEvents,
    essentialEvents,
    commentEvents,
    zapEvents,
    maintainerSet,
    options,
  );
}

// ---------------------------------------------------------------------------
// ResolvedPRLite — lightweight summary for list pages
// ---------------------------------------------------------------------------

/** Discriminator for whether a resolved PR item is a patch or a pull request. */
export type PRItemType = "patch" | "pr";

/**
 * Lightweight resolved view of a PR or root patch for list pages.
 *
 * Contains the core fields derived from merging the raw event with its
 * status, label, and subject-rename events. Used by PRListModel and
 * RepoPRsPage for rendering list rows.
 *
 * For the full detail-page view (with revisions, timeline nodes, tip info),
 * see `ResolvedPR` which extends this interface.
 */
export interface ResolvedPRLite {
  /** The raw event ID */
  id: string;
  /** The author's pubkey */
  pubkey: string;
  /** The raw event — for consumers that need fields not in the flat interface */
  event: NostrEvent;
  /** Whether this is a root patch (kind 1617) or a pull request (kind 1618) */
  itemType: PRItemType;
  /** Original subject from the event itself */
  originalSubject: string;
  /** Current (effective) subject — latest authorised rename, or originalSubject */
  currentSubject: string;
  /** Body text (description tag for patches, content for PRs) */
  content: string;
  /** Unix timestamp (seconds) of the root event */
  createdAt: number;
  /**
   * Unix timestamp (seconds) of the most recent activity — the latest of the
   * root event, any comment, or any status/label event. Used for sorting lists
   * by "most recently active".
   */
  lastActivityAt: number;
  /** Current status — "deleted" takes precedence over all status events */
  status: IssueStatus;
  /** Deduplicated labels from t-tags and NIP-32 label events, sorted */
  labels: string[];
  /** All repository coordinates from #a tags, sorted */
  repoCoords: string[];
  /** Number of NIP-22 comments (kind:1111) */
  commentCount: number;
  /** Number of unique commenter pubkeys */
  participantCount: number;
  /** Number of zap receipts (kind:9735) */
  zapCount: number;
  /** Pubkeys authorised to write status/label/rename events */
  authorisedUsers: Set<string>;
}

// ---------------------------------------------------------------------------
// resolveItemEssentials — per-item resolution shared by detail model & list
// ---------------------------------------------------------------------------

/**
 * The core resolved fields for a single PR/patch/issue, derived from its
 * essentials events. This is the per-item resolution logic extracted from
 * `buildResolvedList` so that both the list model (batch) and the detail
 * model (single item) can share the same auth and resolution rules.
 *
 * @param rootEvent       - The root event (kind 1617, 1618, or 1621)
 * @param essentialEvents - Status, label, and deletion events for this item
 * @param commentEvents   - NIP-22 comments (kind:1111) for this item
 * @param zapEvents       - Zap receipts (kind:9735) for this item
 * @param maintainerSet   - Authorised maintainer pubkeys
 * @param options         - mergeStatusRequiresMaintainer, prUpdateEvents
 */
export function resolveItemEssentials(
  rootEvent: NostrEvent,
  essentialEvents: NostrEvent[],
  commentEvents: NostrEvent[],
  zapEvents: NostrEvent[],
  maintainerSet: Set<string>,
  options: ResolveEssentialsOptions = {},
): ResolvedItemEssentials {
  const { mergeStatusRequiresMaintainer = false, prUpdateEvents } = options;
  const rootId = rootEvent.id;
  const rootPubkey = rootEvent.pubkey;

  // ── Process essentials ──────────────────────────────────────────────────
  let isDeleted = false;
  let latestStatus: { kind: number; createdAt: number } | undefined;
  const nip32Labels = new Set<string>();
  const renames: { createdAt: number; id: string; value: string }[] = [];
  let latestEssentialAt = 0;

  for (const ev of essentialEvents) {
    const evRootId = getNip10References(ev).root?.e?.id;
    if (evRootId !== rootId) continue;

    if (ev.created_at > latestEssentialAt) latestEssentialAt = ev.created_at;

    const isMaintainer = maintainerSet.has(ev.pubkey);
    const isAuthor = ev.pubkey === rootPubkey;

    // Deletion (kind:5) — NIP-09: only the original author's deletion is valid.
    if (ev.kind === DELETION_KIND) {
      if (isAuthor) isDeleted = true;
      continue;
    }

    // Status events (kinds 1630-1633)
    if ((STATUS_KINDS as readonly number[]).includes(ev.kind)) {
      const isMergeStatus =
        ev.kind === STATUS_RESOLVED || ev.kind === STATUS_CLOSED;
      if (mergeStatusRequiresMaintainer && isMergeStatus) {
        if (!isMaintainer) continue;
      } else {
        if (!isAuthor && !isMaintainer) continue;
      }

      if (!latestStatus || ev.created_at > latestStatus.createdAt) {
        latestStatus = { kind: ev.kind, createdAt: ev.created_at };
      }
      continue;
    }

    // Label events (kind:1985)
    if (ev.kind === LABEL_KIND) {
      if (!isAuthor && !isMaintainer) continue;

      const subjectLabel = ev.tags.find(
        ([t, , ns]) => t === "l" && ns === SUBJECT_LABEL_NAMESPACE,
      );
      if (subjectLabel) {
        renames.push({
          createdAt: ev.created_at,
          id: ev.id,
          value: subjectLabel[1],
        });
      }

      for (const [t, label, ns] of ev.tags) {
        if (t === "l" && ns === ISSUE_LABEL_NAMESPACE && label) {
          nip32Labels.add(label);
        }
      }
    }
  }

  // ── Derive status ─────────────────────────────────────────────────────
  let status: IssueStatus;
  if (isDeleted) {
    status = "deleted";
  } else {
    status = latestStatus ? kindToStatus(latestStatus.kind) : "open";
  }

  // ── Derive subject ────────────────────────────────────────────────────
  const originalSubject = extractSubject(rootEvent);
  const sortedRenames = renames.sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const currentSubject =
    sortedRenames.length > 0
      ? sortedRenames[sortedRenames.length - 1].value
      : originalSubject;

  // ── Derive labels ─────────────────────────────────────────────────────
  const tLabels = rootEvent.tags
    .filter(([t, v]) => t === "t" && !PATCH_CHAIN_TAGS.has(v))
    .map(([, v]) => v);
  const labels = Array.from(
    new Set([...tLabels, ...Array.from(nip32Labels)]),
  ).sort();

  // ── Comments and zaps ─────────────────────────────────────────────────
  const filteredComments = commentEvents.filter((ev) => {
    const rootPointer = getCommentRootPointer(ev);
    const commentRootId =
      rootPointer && "id" in rootPointer ? rootPointer.id : undefined;
    return commentRootId === rootId;
  });
  const participantPubkeys = new Set(filteredComments.map((c) => c.pubkey));

  const filteredZapCount = zapEvents.filter((ev) => {
    const zapRootId = getNip10References(ev).root?.e?.id;
    return zapRootId === rootId;
  }).length;

  // ── PR Update activity ────────────────────────────────────────────────
  let latestPRUpdateAt = 0;
  if (prUpdateEvents) {
    for (const ev of prUpdateEvents) {
      const updateRootId = ev.tags.find(([t]) => t === "E")?.[1];
      if (updateRootId === rootId && ev.created_at > latestPRUpdateAt) {
        latestPRUpdateAt = ev.created_at;
      }
    }
  }

  const latestCommentAt = filteredComments.reduce(
    (max, c) => Math.max(max, c.created_at),
    0,
  );
  const lastActivityAt = Math.max(
    rootEvent.created_at,
    latestCommentAt,
    latestEssentialAt,
    latestPRUpdateAt,
  );

  const authorisedUsers = new Set(maintainerSet);
  authorisedUsers.add(rootPubkey);

  return {
    id: rootId,
    pubkey: rootPubkey,
    event: rootEvent,
    originalSubject,
    currentSubject,
    content: extractBody(rootEvent),
    createdAt: rootEvent.created_at,
    lastActivityAt,
    status,
    labels,
    repoCoords: rootEvent.tags
      .filter(([t]) => t === "a")
      .map(([, v]) => v)
      .sort(),
    commentCount: filteredComments.length,
    participantCount: participantPubkeys.size,
    zapCount: filteredZapCount,
    authorisedUsers,
    subjectRenames: sortedRenames,
  };
}

/**
 * The result of resolving a single item's essentials. Extends the core
 * ResolvedIssueLite fields with the sorted rename events (needed by the detail
 * page for the conversation timeline).
 */
export interface ResolvedItemEssentials extends ResolvedIssueLite {
  /** Sorted subject-rename events (oldest first), for timeline display. */
  subjectRenames: { createdAt: number; id: string; value: string }[];
}

// ---------------------------------------------------------------------------
// ResolvedIssue — full detail-page view of an issue
// ---------------------------------------------------------------------------

/**
 * A node in the issue conversation timeline — interleaved comments and
 * subject renames, sorted chronologically.
 */
export type IssueTimelineNode =
  | {
      type: "rename";
      event: NostrEvent;
      oldSubject: string;
      newSubject: string;
      ts: number;
    }
  | {
      type: "thread";
      node: import("@/lib/threadTree").ThreadTreeNode;
      ts: number;
    };

/**
 * The fully-resolved detail-page view of an issue.
 *
 * Extends `ResolvedIssueLite` (the list-page summary) with full comment list,
 * zaps, timeline nodes, rename items, participants, and the raw root event.
 *
 * Produced by `IssueDetailModel`. The UI page consumes this directly without
 * needing to call per-item hooks for status, labels, subject, etc.
 */
export interface ResolvedIssue extends ResolvedIssueLite {
  /** Issue body (same as content, provided for symmetry with ResolvedPR) */
  body: string;

  /**
   * Pre-built conversation timeline: interleaved comments and subject renames,
   * sorted chronologically.
   */
  timelineNodes: IssueTimelineNode[];

  /** All NIP-22 comments (kind:1111) for this issue. */
  comments: NostrEvent[];

  /** Zap receipts (kind:9735) for this issue. */
  zaps: NostrEvent[];

  /** Sorted subject-rename events with old/new subjects for display. */
  renameItems: {
    event: NostrEvent;
    oldSubject: string;
    newSubject: string;
  }[];

  /** All unique participant pubkeys (author + commenters). */
  participants: string[];

  /** The raw root event (kind:1621). */
  rootEvent: NostrEvent;

  /** The effective maintainer set. */
  maintainers: Set<string>;
}

// ---------------------------------------------------------------------------
// Shared detail-page helpers
// ---------------------------------------------------------------------------

/**
 * Build rename items with old/new subjects for display.
 *
 * Used by both IssueDetailModel and PRDetailModel.
 */
export function buildRenameItems(
  originalSubject: string,
  subjectRenames: { createdAt: number; id: string; value: string }[],
  essentialEvents: NostrEvent[],
): { event: NostrEvent; oldSubject: string; newSubject: string }[] {
  if (subjectRenames.length === 0) return [];

  // Build a map of essential events by ID for quick lookup
  const evById = new Map<string, NostrEvent>();
  for (const ev of essentialEvents) evById.set(ev.id, ev);

  let prevSubject = originalSubject;
  return subjectRenames
    .map((rename) => {
      const ev = evById.get(rename.id);
      if (!ev) return null;
      const item = {
        event: ev,
        oldSubject: prevSubject,
        newSubject: rename.value,
      };
      prevSubject = rename.value;
      return item;
    })
    .filter(
      (
        item,
      ): item is {
        event: NostrEvent;
        oldSubject: string;
        newSubject: string;
      } => item !== null,
    );
}

// ---------------------------------------------------------------------------
// ResolvedPR — full detail-page view of a PR or patch
// ---------------------------------------------------------------------------

/**
 * A single revision of a PR or patch set. Unified across both mechanisms:
 * - For patches: a patch chain (original or root-revision)
 * - For PRs: a PR Update event (kind:1619), or the original PR as revision 0
 */
export interface PRRevision {
  /** Discriminator: "patch-set" for patch chains, "pr-update" for kind:1619 */
  type: "patch-set" | "pr-update";
  /** Timestamp of this revision */
  createdAt: number;
  /** Tip commit ID from this revision, if available */
  tipCommitId: string | undefined;
  /** Merge-base from tags, if available */
  mergeBase: string | undefined;
  /** Clone URLs from this revision's tags */
  cloneUrls: string[];
  /** True when this revision has been superseded by a later one */
  superseded: boolean;
  /** The pubkey of the revision author */
  pubkey: string;
  /**
   * For patch-set revisions: the ordered patches in this chain.
   * Undefined for pr-update revisions.
   */
  patches?: import("@/casts/Patch").Patch[];
  /**
   * For pr-update revisions: the raw PR Update event.
   * Undefined for patch-set revisions.
   */
  updateEvent?: NostrEvent;
  /**
   * For patch-set revisions: the root patch of this revision.
   * Undefined for pr-update revisions.
   */
  rootPatchEvent?: NostrEvent;
}

/**
 * A node in the conversation timeline — interleaved push events, comments,
 * and subject renames, sorted chronologically.
 */
export type PRTimelineNode =
  | { type: "revision"; revision: PRRevision; ts: number }
  | {
      type: "rename";
      event: NostrEvent;
      oldSubject: string;
      newSubject: string;
      ts: number;
    }
  | {
      type: "thread";
      node: import("@/lib/threadTree").ThreadTreeNode;
      ts: number;
    };

/**
 * The fully-resolved detail-page view of a PR or patch.
 *
 * Extends `ResolvedPRLite` (the list-page summary) with revision history,
 * timeline nodes, tip info, comments, and other detail-page data.
 *
 * Produced by `PRDetailModel`. The UI page consumes this directly without
 * needing to call per-item hooks for status, labels, subject, etc.
 */
export interface ResolvedPR extends ResolvedPRLite {
  /** Body text (description tag for patches, content for PRs) */
  body: string;

  /**
   * All revisions ordered oldest-first. The last entry is the current
   * (latest) revision; all earlier ones are superseded.
   *
   * For patches: one entry per patch chain (original + root-revisions).
   * For PRs: one entry per kind:1619 PR Update (plus the original PR as
   * revision 0 when it has a tip commit).
   */
  revisions: PRRevision[];

  /**
   * The effective tip info from the latest authorised revision.
   * Unified across both PR and patch mechanisms.
   */
  tip: {
    /** Tip commit ID from the latest revision */
    commitId: string | undefined;
    /** Merge-base from tags (explicit), if available */
    explicitMergeBase: string | undefined;
    /** Clone URLs from the latest revision + the root event */
    cloneUrls: string[];
  };

  /**
   * Pre-built conversation timeline: interleaved push events, comments,
   * and subject renames, sorted chronologically.
   */
  timelineNodes: PRTimelineNode[];

  /** All NIP-22 comments (kind:1111) across all revisions, deduplicated. */
  comments: NostrEvent[];

  /** Zap receipts (kind:9735) for this item. */
  zaps: NostrEvent[];

  /** Sorted subject-rename events with old/new subjects for display. */
  renameItems: {
    event: NostrEvent;
    oldSubject: string;
    newSubject: string;
  }[];

  /** All unique participant pubkeys (author + commenters + update authors). */
  participants: string[];

  /** The raw root event (kind:1617 or kind:1618). */
  rootEvent: NostrEvent;

  /** The effective maintainer set. */
  maintainers: Set<string>;

  /**
   * For patches: the raw patch diff from the root patch's content.
   * Undefined for PRs.
   */
  patchDiff?: string;

  /**
   * For patches: commits from the first (original) revision that were
   * published at roughly the same time as the root event (within a few
   * seconds). These are shown inline in the body card, matching the PR
   * behaviour. Undefined when the first revision was published later (i.e.
   * it was a separate push and should remain in the timeline).
   */
  initialPatchCommits?: Array<{
    commitId: string | undefined;
    subject: string;
  }>;

  /**
   * True when the first patch revision has been inlined into the body card
   * via `initialPatchCommits`. The timeline should skip rendering that
   * revision as a separate push event.
   */
  firstRevisionInlined?: boolean;
}

// ---------------------------------------------------------------------------
// buildResolvedPRs — batch builder for list pages
// ---------------------------------------------------------------------------

/**
 * Build a sorted list of ResolvedPRLite objects from raw patch and PR events.
 * Identical to buildResolvedIssues but mergeStatusRequiresMaintainer=true and
 * each item gets an itemType discriminator ("patch" | "pr").
 *
 * prUpdateEvents (kind:1619) are factored into lastActivityAt so the list
 * sorts correctly when a PR branch is updated. They are NOT counted as
 * comments.
 */
export function buildResolvedPRs(
  rootEvents: NostrEvent[],
  essentialEvents: NostrEvent[],
  commentEvents: NostrEvent[],
  zapEvents: NostrEvent[],
  maintainerSet: Set<string>,
  prUpdateEvents: NostrEvent[] = [],
): ResolvedPRLite[] {
  return buildResolvedList(
    rootEvents,
    essentialEvents,
    commentEvents,
    zapEvents,
    maintainerSet,
    {
      mergeStatusRequiresMaintainer: true,
      prUpdateEvents,
    },
  ).map((item) => ({
    ...item,
    itemType: (item.event.kind === PATCH_KIND ? "patch" : "pr") as PRItemType,
  }));
}

// ---------------------------------------------------------------------------
// BFS chain resolution
// ---------------------------------------------------------------------------

/**
 * Given a set of 30617 announcement events already in memory, resolve the
 * transitive maintainer chain starting from `selectedMaintainer` for a given
 * `dTag`. Returns a `ResolvedRepo` or `undefined` if the selected maintainer
 * has no announcement for this dTag.
 *
 * This is a pure function — no side effects, no relay fetches. Both
 * RepositoryListModel (bulk) and RepositoryModel (single) use this.
 */
export function resolveChain(
  events: NostrEvent[],
  selectedMaintainer: string,
  dTag: string,
): ResolvedRepo | undefined {
  // Index all announcements for this dTag by pubkey for O(1) lookup
  const byPubkey = new Map<string, NostrEvent>();
  for (const ev of events) {
    if (ev.kind !== REPO_KIND) continue;
    const d = getReplaceableIdentifier(ev);
    if (d !== dTag) continue;
    const existing = byPubkey.get(ev.pubkey);
    // Keep only the latest announcement per pubkey (store handles this but
    // be defensive in case we receive multiple)
    if (!existing || ev.created_at > existing.created_at) {
      byPubkey.set(ev.pubkey, ev);
    }
  }

  // The selected maintainer must have an announcement to anchor the chain
  if (!byPubkey.has(selectedMaintainer)) return undefined;

  // BFS over the maintainer graph — collect all reachable pubkeys
  const reachable = new Set<string>();
  const queue: string[] = [selectedMaintainer];
  const edges: MaintainerEdge[] = [];
  const pending: string[] = [];

  while (queue.length > 0) {
    const pubkey = queue.shift()!;
    if (reachable.has(pubkey)) continue;
    reachable.add(pubkey);

    const ev = byPubkey.get(pubkey);
    if (!ev) {
      // Listed as maintainer but no announcement yet
      pending.push(pubkey);
      continue;
    }

    // Read maintainers tag — format: ["maintainers", pubkey1, pubkey2, ...]
    const listed = getRepoMaintainers(ev);

    for (const listed_pubkey of listed) {
      edges.push({ from: pubkey, to: listed_pubkey });
      if (!reachable.has(listed_pubkey)) {
        queue.push(listed_pubkey);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Reciprocation check — determine confirmed vs requested maintainers.
  //
  // A maintainer B is "confirmed" if:
  //   1. B is the selectedMaintainer (always trusted as the anchor), OR
  //   2. B has published their own announcement for this dTag AND B's
  //      announcement lists at least one already-confirmed maintainer.
  //
  // This prevents reputation hijacking: an attacker cannot inflate their
  // project's credibility by listing a reputable pubkey as a maintainer
  // unless that pubkey has reciprocated by listing someone in the confirmed
  // set back.
  //
  // We use an iterative fixed-point loop because reciprocation can be
  // transitive: A confirms B, B confirms C, C confirms D, etc.
  // ---------------------------------------------------------------------------
  const confirmed = new Set<string>([selectedMaintainer]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pubkey of reachable) {
      if (confirmed.has(pubkey)) continue;
      const ev = byPubkey.get(pubkey);
      if (!ev) continue; // pending — no announcement, cannot self-confirm
      const listed = getRepoMaintainers(ev);
      if (listed.some((pk) => confirmed.has(pk))) {
        confirmed.add(pubkey);
        changed = true;
      }
    }
  }

  // Pubkeys reachable but not confirmed (have an announcement but no back-link)
  // — merge into pending alongside those with no announcement at all.
  for (const pubkey of reachable) {
    if (!confirmed.has(pubkey) && byPubkey.has(pubkey)) {
      pending.push(pubkey);
    }
  }

  // Collect all announcements for confirmed pubkeys only
  const announcements: NostrEvent[] = [];
  for (const pubkey of confirmed) {
    const ev = byPubkey.get(pubkey);
    if (ev) announcements.push(ev);
  }

  // --- Merge fields ---

  // Latest-wins: name, description, webUrls
  let latestEv = announcements[0];
  for (const ev of announcements) {
    if (ev.created_at > latestEv.created_at) latestEv = ev;
  }

  // Find the latest announcement that actually has a name/description
  // (fall back to overall latest if none have it)
  const nameSource = announcements.reduce(
    (best, ev) => {
      const val = getRepoName(ev);
      if (!val) return best;
      return ev.created_at > best.createdAt
        ? { pubkey: ev.pubkey, createdAt: ev.created_at, value: val }
        : best;
    },
    { pubkey: latestEv.pubkey, createdAt: 0, value: getRepoName(latestEv) },
  );

  const descriptionSource = announcements.reduce(
    (best, ev) => {
      const val = getRepoDescription(ev);
      return ev.created_at > best.createdAt
        ? { pubkey: ev.pubkey, createdAt: ev.created_at, value: val }
        : best;
    },
    {
      pubkey: latestEv.pubkey,
      createdAt: 0,
      value: getRepoDescription(latestEv),
    },
  );

  // Union: clone URLs and relays with provenance
  const cloneUrlProvenance: FieldProvenance[] = [];
  const relayProvenance: FieldProvenance[] = [];
  const seenClone = new Set<string>();
  const seenRelay = new Set<string>();
  const seenLabel = new Set<string>();
  const labels: string[] = [];

  for (const ev of announcements) {
    for (const v of getRepoCloneUrls(ev)) {
      if (!seenClone.has(v)) {
        seenClone.add(v);
        cloneUrlProvenance.push({
          pubkey: ev.pubkey,
          createdAt: ev.created_at,
          value: v,
        });
      }
    }
    for (const v of getRepoRelays(ev)) {
      if (!seenRelay.has(v)) {
        seenRelay.add(v);
        relayProvenance.push({
          pubkey: ev.pubkey,
          createdAt: ev.created_at,
          value: v,
        });
      }
    }
    for (const [t, v] of ev.tags) {
      if (t === "t" && v && v !== "personal-fork" && !seenLabel.has(v)) {
        seenLabel.add(v);
        labels.push(v);
      }
    }
  }

  const maintainerSet = Array.from(confirmed);

  const allCloneUrls = cloneUrlProvenance.map((p) => p.value);
  const graspCloneUrls = allCloneUrls.filter(isGraspCloneUrl);
  const additionalGitServerUrls = allCloneUrls.filter(
    (u) => !isGraspCloneUrl(u),
  );
  const graspServerDomains = Array.from(
    new Set(
      graspCloneUrls
        .map(graspCloneUrlDomain)
        .filter((d): d is string => d !== undefined),
    ),
  );

  return {
    selectedMaintainer,
    dTag,
    name: nameSource.value || dTag,
    description: descriptionSource.value,
    webUrls: getRepoWebUrls(latestEv),
    updatedAt: latestEv.created_at,
    cloneUrls: allCloneUrls,
    graspCloneUrls,
    additionalGitServerUrls,
    graspServerDomains,
    relays: relayProvenance.map((p) => p.value),
    maintainerSet,
    allCoordinates: maintainerSet.map((pk) => repoCoordinate(pk, dTag)),
    requestedMaintainers: pending,
    labels,
    announcements,
    maintainerEdges: edges,
    cloneUrlProvenance,
    relayProvenance,
    nameSource,
    descriptionSource,
  };
}

/**
 * Given all 30617 events in the store, group them into resolved repositories.
 * Each connected component (by mutual maintainer listing) becomes one entry.
 * Only repos reachable from `selectedMaintainer` are included.
 *
 * For repos where the selected maintainer is NOT in the chain, we pick a
 * random maintainer from the connected component as the route anchor
 * (selectedMaintainer field). This will be refined later (e.g. prefer followed
 * users).
 */
/**
 * Given all 30617 events in the store, group them into resolved repositories.
 * Each connected component (by mutual maintainer listing) becomes one entry.
 *
 * @param events - All 30617 events to consider
 * @param forPubkey - If provided, only return repos where this pubkey is
 *   involved — either as the event author or listed in a `maintainers` tag.
 *   The pubkey is used as the selectedMaintainer when they have their own
 *   announcement; otherwise the event author who listed them is used.
 */
export function groupIntoResolvedRepos(
  events: NostrEvent[],
  forPubkey?: string,
): ResolvedRepo[] {
  // Collect all distinct dTags
  const dTags = new Set<string>();
  for (const ev of events) {
    if (ev.kind !== REPO_KIND) continue;
    const d = getReplaceableIdentifier(ev);
    if (d) dTags.add(d);
  }

  const results: ResolvedRepo[] = [];
  const processedComponents = new Set<string>(); // "pubkey:dTag" keys already in a result

  for (const dTag of dTags) {
    if (forPubkey) {
      // Scoped mode: find repos where forPubkey is involved as author or
      // maintainer, then resolve the chain with forPubkey as selected
      // maintainer when possible.

      // First try: the user has their own announcement for this dTag
      const resolved = resolveChain(events, forPubkey, dTag);
      if (resolved) {
        results.push(resolved);
        continue;
      }

      // Second try: the user is listed in someone else's maintainers tag
      // for this dTag but hasn't published their own announcement.
      // Find an event author who listed them and resolve from that author.
      for (const ev of events) {
        if (ev.kind !== REPO_KIND) continue;
        const d = getReplaceableIdentifier(ev);
        if (d !== dTag) continue;

        // Check if forPubkey is the event author (already handled above)
        if (ev.pubkey === forPubkey) continue;

        // Check if forPubkey is listed in the maintainers tag
        if (getRepoMaintainers(ev).includes(forPubkey)) {
          // Resolve from the event author who listed us
          const fromAuthor = resolveChain(events, ev.pubkey, dTag);
          if (fromAuthor) {
            results.push(fromAuthor);
            break; // Only need one result per dTag
          }
        }
      }
    } else {
      // Global mode: resolve all connected components
      const pubkeysForDTag: string[] = [];
      for (const ev of events) {
        if (ev.kind !== REPO_KIND) continue;
        const d = getReplaceableIdentifier(ev);
        if (d === dTag) pubkeysForDTag.push(ev.pubkey);
      }

      for (const startPubkey of pubkeysForDTag) {
        const componentKey = `${startPubkey}:${dTag}`;
        if (processedComponents.has(componentKey)) continue;

        const resolved = resolveChain(events, startPubkey, dTag);
        if (!resolved) continue;

        // Mark all members of this component as processed
        for (const pk of resolved.maintainerSet) {
          processedComponents.add(`${pk}:${dTag}`);
        }

        results.push(resolved);
      }
    }
  }

  // Sort by updatedAt descending
  results.sort((a, b) => b.updatedAt - a.updatedAt);
  return results;
}
