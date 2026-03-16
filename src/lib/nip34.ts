/**
 * NIP-34 Git Stuff - Constants and helpers
 */

import type { NostrEvent } from "nostr-tools";
import { ISSUE_LABEL_NAMESPACE } from "@/blueprints/label";

/** Repository announcement (addressable, kind 30617) */
export const REPO_KIND = 30617;

/** Git issue (kind 1621) */
export const ISSUE_KIND = 1621;

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
  /** Unix timestamp (seconds) */
  createdAt: number;
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
// resolveEssentials — shared pure function for issue/patch/PR resolution
// ---------------------------------------------------------------------------

/**
 * Options that vary between entity types when resolving essentials.
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
 * Intermediate resolved metadata for a single root event, produced by
 * resolveEssentials before being merged with the raw event into a ResolvedIssue.
 */
interface ResolvedMeta {
  status: IssueStatus;
  labels: string[];
  currentSubject: string;
}

/**
 * Given a set of root events (issues, patches, or PRs) and their associated
 * essentials events (status, labels, deletions), derive the resolved metadata
 * for each root event.
 *
 * This is a pure function — no hooks, no subscriptions, no side effects.
 * Both IssueListModel and future PatchListModel use this.
 *
 * Auth rules:
 * - Deletion (kind:5): only the root event author is valid (NIP-09).
 * - Status events: the root event author and all maintainers are authorised.
 *   When mergeStatusRequiresMaintainer is true, only maintainers may set
 *   resolved/closed status (for patches/PRs).
 * - Label events: the root event author and all maintainers are authorised.
 *
 * Deletion takes precedence over all status events — once deleted, the status
 * is "deleted" regardless of any status events.
 *
 * @param rootEvents      - The raw root events (e.g. all kind:1621 issues)
 * @param essentialEvents - Status, label, and deletion events referencing roots
 * @param maintainerSet   - Authorised maintainer pubkeys (derived from coords)
 * @param options         - Per-entity-type auth tweaks
 */
export function resolveEssentials(
  rootEvents: NostrEvent[],
  essentialEvents: NostrEvent[],
  maintainerSet: Set<string>,
  options: ResolveEssentialsOptions = {},
): Map<string, ResolvedMeta> {
  const { mergeStatusRequiresMaintainer = false } = options;

  // Index root events by ID for O(1) author lookup.
  const authorById = new Map<string, string>();
  const subjectById = new Map<string, string>();
  const tLabelsById = new Map<string, string[]>();

  for (const ev of rootEvents) {
    authorById.set(ev.id, ev.pubkey);
    subjectById.set(
      ev.id,
      ev.tags.find(([t]) => t === "subject")?.[1] ?? "(untitled)",
    );
    tLabelsById.set(
      ev.id,
      ev.tags.filter(([t]) => t === "t").map(([, v]) => v),
    );
  }

  // Accumulators — one entry per root event ID.
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

  for (const ev of essentialEvents) {
    // Find the referenced root event ID from the "e" tag.
    const rootId = ev.tags.find(([t]) => t === "e")?.[1];
    if (!rootId || !authorById.has(rootId)) continue;

    const issuePubkey = authorById.get(rootId)!;
    const isMaintainer = maintainerSet.has(ev.pubkey);
    const isAuthor = ev.pubkey === issuePubkey;

    // ── Deletion (kind:5) ──────────────────────────────────────────────────
    // NIP-09: only the original author's deletion is valid.
    if (ev.kind === DELETION_KIND) {
      if (isAuthor) deletedIds.add(rootId);
      continue;
    }

    // ── Status events (kinds 1630–1633) ────────────────────────────────────
    if ((STATUS_KINDS as readonly number[]).includes(ev.kind)) {
      // Status events use an "e" tag with marker "root" to reference the issue.
      const rootTag = ev.tags.find(
        ([t, , , marker]) => t === "e" && marker === "root",
      );
      if (!rootTag) continue;
      const statusRootId = rootTag[1];
      if (!authorById.has(statusRootId)) continue;

      // Auth check: for merge-status kinds, only maintainers are authorised.
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

    // ── Label events (kind:1985) ───────────────────────────────────────────
    if (ev.kind === LABEL_KIND) {
      if (!isAuthor && !isMaintainer) continue;

      // Subject renames: carry the #subject namespace.
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

      // Regular labels: carry the issue label namespace.
      for (const [t, label, ns] of ev.tags) {
        if (t === "l" && ns === ISSUE_LABEL_NAMESPACE && label) {
          const set = labelsByRoot.get(rootId) ?? new Set<string>();
          set.add(label);
          labelsByRoot.set(rootId, set);
        }
      }
    }
  }

  // Build the result map.
  const result = new Map<string, ResolvedMeta>();

  for (const [id] of authorById) {
    // Deletion takes precedence over all status events.
    let status: IssueStatus;
    if (deletedIds.has(id)) {
      status = "deleted";
    } else {
      const latestStatus = latestStatusByRoot.get(id);
      status = latestStatus ? kindToStatus(latestStatus.kind) : "open";
    }

    // Merge t-tag labels with NIP-32 label events, deduplicate and sort.
    const tLabels = tLabelsById.get(id) ?? [];
    const nip32Labels = Array.from(labelsByRoot.get(id) ?? []);
    const labels = Array.from(new Set([...tLabels, ...nip32Labels])).sort();

    // Current subject: latest rename wins (sort ascending, last entry wins).
    const renames = (renamesByRoot.get(id) ?? []).sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
    const originalSubject = subjectById.get(id)!;
    const currentSubject =
      renames.length > 0 ? renames[renames.length - 1].value : originalSubject;

    result.set(id, { status, labels, currentSubject });
  }

  return result;
}

/**
 * Build a list of ResolvedIssue objects from raw events.
 *
 * Combines resolveEssentials (status/labels/subject/deletion) with per-issue
 * counts derived from comment and zap events. All inputs are plain arrays —
 * this is a pure function with no side effects.
 *
 * Comment and zap arrays default to empty when the loader has not yet fetched
 * them, so counts are 0 on the list page and populate live on the detail page
 * as useNip34Loaders fetches deeper data into the store.
 *
 * @param rootEvents      - Raw issue events (kind:1621)
 * @param essentialEvents - Status, label, and deletion events (#e root IDs)
 * @param commentEvents   - NIP-22 comment events (kind:1111, #E root IDs)
 * @param zapEvents       - Zap receipt events (kind:9735, #e root IDs)
 * @param maintainerSet   - Authorised maintainer pubkeys
 * @param options         - Per-entity-type auth tweaks for resolveEssentials
 */
export function buildResolvedIssues(
  rootEvents: NostrEvent[],
  essentialEvents: NostrEvent[],
  commentEvents: NostrEvent[],
  zapEvents: NostrEvent[],
  maintainerSet: Set<string>,
  options: ResolveEssentialsOptions = {},
): ResolvedIssue[] {
  const metaMap = resolveEssentials(
    rootEvents,
    essentialEvents,
    maintainerSet,
    options,
  );

  // Index comments and zaps by root ID for O(1) per-issue lookup.
  const commentsByRoot = new Map<string, NostrEvent[]>();
  for (const ev of commentEvents) {
    // NIP-22 uses uppercase E for the root reference.
    const rootId =
      ev.tags.find(([t, , , marker]) => t === "E" && marker === "root")?.[1] ??
      ev.tags.find(([t]) => t === "E")?.[1];
    if (!rootId) continue;
    const existing = commentsByRoot.get(rootId) ?? [];
    existing.push(ev);
    commentsByRoot.set(rootId, existing);
  }

  const zapsByRoot = new Map<string, number>();
  for (const ev of zapEvents) {
    const rootId = ev.tags.find(([t]) => t === "e")?.[1];
    if (!rootId) continue;
    zapsByRoot.set(rootId, (zapsByRoot.get(rootId) ?? 0) + 1);
  }

  return rootEvents.map((ev): ResolvedIssue => {
    const originalSubject =
      ev.tags.find(([t]) => t === "subject")?.[1] ?? "(untitled)";
    const meta = metaMap.get(ev.id) ?? {
      status: "open" as const,
      labels: ev.tags
        .filter(([t]) => t === "t")
        .map(([, v]) => v)
        .sort(),
      currentSubject: originalSubject,
    };

    const comments = commentsByRoot.get(ev.id) ?? [];
    const participantPubkeys = new Set(comments.map((c) => c.pubkey));

    // Build the authorised set: issue author + all maintainers.
    const authorisedUsers = new Set(maintainerSet);
    authorisedUsers.add(ev.pubkey);

    return {
      id: ev.id,
      pubkey: ev.pubkey,
      event: ev,
      originalSubject,
      currentSubject: meta.currentSubject,
      content: ev.content,
      createdAt: ev.created_at,
      status: meta.status,
      labels: meta.labels,
      repoCoords: ev.tags
        .filter(([t]) => t === "a")
        .map(([, v]) => v)
        .sort(),
      commentCount: comments.length,
      participantCount: participantPubkeys.size,
      zapCount: zapsByRoot.get(ev.id) ?? 0,
      authorisedUsers,
    };
  });
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
    const d = ev.tags.find(([t]) => t === "d")?.[1];
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
    const maintainersTag = ev.tags.find(([t]) => t === "maintainers");
    const listed = maintainersTag ? maintainersTag.slice(1) : [];

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

  const getName = (ev: NostrEvent) =>
    ev.tags.find(([t]) => t === "name")?.[1] ??
    ev.tags.find(([t]) => t === "d")?.[1] ??
    "";
  const getDescription = (ev: NostrEvent) =>
    ev.tags.find(([t]) => t === "description")?.[1] ?? ev.content ?? "";
  const getWebUrls = (ev: NostrEvent) =>
    ev.tags.filter(([t]) => t === "web").map(([, v]) => v);

  // Find the latest announcement that actually has a name/description
  // (fall back to overall latest if none have it)
  const nameSource = announcements.reduce(
    (best, ev) => {
      const val = getName(ev);
      if (!val) return best;
      return ev.created_at > best.createdAt
        ? { pubkey: ev.pubkey, createdAt: ev.created_at, value: val }
        : best;
    },
    { pubkey: latestEv.pubkey, createdAt: 0, value: getName(latestEv) },
  );

  const descriptionSource = announcements.reduce(
    (best, ev) => {
      const val = getDescription(ev);
      return ev.created_at > best.createdAt
        ? { pubkey: ev.pubkey, createdAt: ev.created_at, value: val }
        : best;
    },
    {
      pubkey: latestEv.pubkey,
      createdAt: 0,
      value: getDescription(latestEv),
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
    for (const [t, v] of ev.tags) {
      if (t === "clone" && v && !seenClone.has(v)) {
        seenClone.add(v);
        cloneUrlProvenance.push({
          pubkey: ev.pubkey,
          createdAt: ev.created_at,
          value: v,
        });
      }
      if (t === "relays" && v && !seenRelay.has(v)) {
        seenRelay.add(v);
        relayProvenance.push({
          pubkey: ev.pubkey,
          createdAt: ev.created_at,
          value: v,
        });
      }
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
    webUrls: getWebUrls(latestEv),
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
    const d = ev.tags.find(([t]) => t === "d")?.[1];
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
        const d = ev.tags.find(([t]) => t === "d")?.[1];
        if (d !== dTag) continue;

        // Check if forPubkey is the event author (already handled above)
        if (ev.pubkey === forPubkey) continue;

        // Check if forPubkey is listed in the maintainers tag
        const maintainersTag = ev.tags.find(([t]) => t === "maintainers");
        const listed = maintainersTag ? maintainersTag.slice(1) : [];
        if (listed.includes(forPubkey)) {
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
        const d = ev.tags.find(([t]) => t === "d")?.[1];
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
