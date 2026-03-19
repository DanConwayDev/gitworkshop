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
 */
export function getStateRefs(ev: NostrEvent): RepoStateRef[] {
  return getOrComputeCachedValue(ev, StateRefsSymbol, () =>
    ev.tags
      .filter(([t]) => t?.startsWith("refs/"))
      .map(([name, commitId, ...parents]) => ({
        name,
        commitId: commitId ?? "",
        parentCommitIds: parents.filter(Boolean),
      }))
      .filter((r) => r.commitId),
  );
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

/** Default git index relay URL. */
export const NGIT_RELAY = "wss://relay.ngit.dev";

/**
 * Options controlling which relays are queried for repo-specific events
 * (issues, comments, status, zaps). Announcement events (kind 30617) are
 * always fetched from NGIT_RELAYS regardless of these options.
 *
 * relayHints: extra relays to query in addition to the repo's declared relays.
 *   Defaults to [] (empty). Populated from naddr URL relay hints or per-repo
 *   settings. NGIT_RELAYS is NOT included by default — add it here explicitly
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
  /** All relay URLs across all maintainer announcements, deduplicated */
  relays: string[];

  // --- Maintainer set ---
  /** All pubkeys in the transitive closure reachable from selectedMaintainer */
  maintainerSet: string[];
  /**
   * "30617:<pubkey>:<dTag>" for every maintainer — used for #a tag queries
   * on issues, PRs, and patches.
   */
  allCoordinates: string[];
  /** Pubkeys listed as maintainers but who haven't published their own announcement */
  pendingMaintainers: string[];
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
// ResolvedIssue — merged view of an issue + its essentials events
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
 */
export interface ResolvedIssue {
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
   * Number of NIP-22 comments (kind:1111). Zero until useNip34Loaders has
   * fetched comment events into the store.
   */
  commentCount: number;
  /**
   * Number of unique commenter pubkeys (including the issue author).
   * Zero until useNip34Loaders has fetched comment events into the store.
   */
  participantCount: number;
  /**
   * Number of zap receipts (kind:9735). Zero until useNip34Loaders has
   * fetched zap events into the store.
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
 */
export interface ResolveEssentialsOptions {
  mergeStatusRequiresMaintainer?: boolean;
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
): (ResolvedIssue & { itemType?: PRItemType })[] {
  const { mergeStatusRequiresMaintainer = false } = options;

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
 * Build a sorted list of ResolvedIssue objects from raw events. Pure function,
 * no side effects. Comment/zap counts are 0 until useNip34Loaders fetches them.
 */
export function buildResolvedIssues(
  rootEvents: NostrEvent[],
  essentialEvents: NostrEvent[],
  commentEvents: NostrEvent[],
  zapEvents: NostrEvent[],
  maintainerSet: Set<string>,
  options: ResolveEssentialsOptions = {},
): ResolvedIssue[] {
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
// ResolvedPR — merged view of a PR or root patch + its essentials events
// ---------------------------------------------------------------------------

/** Discriminator for whether a resolved PR item is a patch or a pull request. */
export type PRItemType = "patch" | "pr";

/**
 * The fully-resolved view of a PR or root patch after merging the raw event
 * with its status, label, and subject-rename events.
 *
 * Structurally identical to ResolvedIssue but with an `itemType` discriminator
 * and `mergeStatusRequiresMaintainer` semantics (the item author cannot issue
 * merge/resolved statuses — only maintainers can).
 */
export interface ResolvedPR {
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

/**
 * Build a sorted list of ResolvedPR objects from raw patch and PR events.
 * Identical to buildResolvedIssues but mergeStatusRequiresMaintainer=true and
 * each item gets an itemType discriminator ("patch" | "pr").
 */
export function buildResolvedPRs(
  rootEvents: NostrEvent[],
  essentialEvents: NostrEvent[],
  commentEvents: NostrEvent[],
  zapEvents: NostrEvent[],
  maintainerSet: Set<string>,
): ResolvedPR[] {
  return buildResolvedList(
    rootEvents,
    essentialEvents,
    commentEvents,
    zapEvents,
    maintainerSet,
    {
      mergeStatusRequiresMaintainer: true,
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

  // BFS over the maintainer graph
  const visited = new Set<string>();
  const queue: string[] = [selectedMaintainer];
  const edges: MaintainerEdge[] = [];
  const pending: string[] = [];

  while (queue.length > 0) {
    const pubkey = queue.shift()!;
    if (visited.has(pubkey)) continue;
    visited.add(pubkey);

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
      if (!visited.has(listed_pubkey)) {
        queue.push(listed_pubkey);
      }
    }
  }

  // Collect all announcements for visited pubkeys (excluding pending)
  const announcements: NostrEvent[] = [];
  for (const pubkey of visited) {
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

  const maintainerSet = Array.from(visited);

  return {
    selectedMaintainer,
    dTag,
    name: nameSource.value || dTag,
    description: descriptionSource.value,
    webUrls: getRepoWebUrls(latestEv),
    updatedAt: latestEv.created_at,
    cloneUrls: cloneUrlProvenance.map((p) => p.value),
    relays: relayProvenance.map((p) => p.value),
    maintainerSet,
    allCoordinates: maintainerSet.map((pk) => repoCoordinate(pk, dTag)),
    pendingMaintainers: pending,
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
