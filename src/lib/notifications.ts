/**
 * Notification system — constants, types, filters, and grouping logic.
 *
 * Two categories of notifications:
 *
 * Thread notifications — activity on issues/PRs/patches:
 *   1. NIP-22 comments (kind:1111) on issues/PRs/patches authored by us
 *      (uppercase #P tag + #K filter for NIP-34 root kinds)
 *   2. New issues/PRs/patches/PR-updates/status-changes/cover-notes that tag
 *      us via #p (someone filed an issue on our repo, pushed a PR update,
 *      closed an issue we authored, posted a cover note on our item, etc.)
 *   3. Legacy NIP-34 replies (kind:1622) that tag us via #p
 *   4. NIP-57 zap receipts (kind:9735) on issues/PRs/patches or our comments
 *      where we are the recipient (#p tag)
 *
 * Social notifications — repo stars, repo zaps:
 *   5. kind:7 reactions with content "+" targeting our repos (#k:30617, #a)
 *   6. kind:9735 zap receipts targeting our repo announcements (#k:30617, #a)
 *
 * Social items are grouped:
 *   - Repo stars → one item per repo, rootId "stars:<repoCoord>"
 *   - Repo zaps  → one item per repo, rootId "zaps:<repoCoord>"
 *
 * Read/archived state uses a concise high-water-mark model (inspired by
 * gitworkshop) stored in a NIP-78 event for cross-device sync:
 *   - A timestamp cutoff marks everything older as read/archived
 *   - An ID array tracks individual exceptions after the cutoff
 *   - Periodically the cutoff advances and the array is pruned
 */

import type { NostrEvent } from "nostr-tools";
import type { Filter } from "applesauce-core/helpers";
import {
  getCommentRootPointer,
  getNip10References,
  getZapAmount,
  getZapRequest,
  getZapSender,
  getZapEventPointer,
  getZapAddressPointer,
} from "applesauce-common/helpers";
import { getParentId } from "@/lib/threadTree";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  PR_UPDATE_KIND,
  COMMENT_KIND,
  COVER_NOTE_KIND,
  LEGACY_REPLY_KIND,
  STATUS_KINDS,
  REPO_KIND,
} from "@/lib/nip34";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NIP-78 kind for arbitrary app data */
export const NIP78_KIND = 30078;

/** d-tag for our notification read-state event (signed by the dedicated nsec) */
export const NOTIFICATION_STATE_D_TAG = "git-notifications-state";

/**
 * d-tag for the nsec envelope event.
 *
 * This NIP-78 event is encrypted with the user's own signer (NIP-44) and
 * contains only the hex private key of a dedicated notification keypair.
 * It is decrypted once and the plaintext is cached in localStorage so
 * subsequent state updates never require the user's signer.
 */
export const NOTIFICATION_NSEC_D_TAG = "git-notifications-nsec";

/** NIP-34 root kinds whose comments generate notifications */
export const NIP34_ROOT_KINDS = [PATCH_KIND, PR_KIND, ISSUE_KIND] as const;

/** NIP-25 kind:7 — reaction */
export const REACTION_KIND = 7;

/** NIP-57 kind:9735 — zap receipt */
export const ZAP_RECEIPT_KIND = 9735;

/** Prefix for repo-star notification rootIds */
export const REPO_STARS_PREFIX = "stars:";

/** Prefix for repo-zap notification rootIds */
export const REPO_ZAPS_PREFIX = "zaps:";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Concise read/archived state persisted to NIP-78.
 * Short keys keep the encrypted payload small.
 */
export interface NotificationReadState {
  /** Everything before this timestamp is read */
  rb: number;
  /** Event IDs individually marked read after the cutoff */
  ri: string[];
  /** Everything before this timestamp is archived */
  ab: number;
  /** Event IDs individually marked archived after the cutoff */
  ai: string[];
}

/**
 * A thread notification group — all events related to a single issue/PR/patch.
 * rootId is always a Nostr event ID (hex).
 */
export interface ThreadNotificationItem {
  kind: "thread";
  /** The root issue/PR/patch event ID */
  rootId: string;
  /** All notification events for this root, sorted newest-first */
  events: NostrEvent[];
  /** Whether any event in this group is unread */
  unread: boolean;
  /** Whether this group is archived */
  archived: boolean;
  /** IDs of the specific events that are archived (subset of events[].id). */
  archivedEventIds: string[];
  /** Most recent event timestamp in this group */
  latestActivity: number;
  /**
   * IDs of the specific events that are unread (subset of events[].id).
   * Sorted oldest-first so the first entry is the oldest unread event —
   * useful for anchor-scrolling to the first new content.
   */
  unreadEventIds: string[];
}

/**
 * A social notification group — repo stars.
 * rootId is a synthetic string (not a Nostr event ID).
 */
export interface SocialNotificationItem {
  kind: "repo-star";
  /**
   * Synthetic root ID: "stars:30617:<pubkey>:<dtag>"
   */
  rootId: string;
  /** The repo coordinate for this item */
  repoCoord: string;
  /** All events in this group, sorted newest-first */
  events: NostrEvent[];
  /** Whether any event in this group is unread */
  unread: boolean;
  /** Whether this group is archived */
  archived: boolean;
  /** IDs of the specific events that are archived (subset of events[].id). */
  archivedEventIds: string[];
  /** Most recent event timestamp in this group */
  latestActivity: number;
  /** Unread event IDs, oldest-first */
  unreadEventIds: string[];
}

/**
 * A social notification group — repo zaps (kind:9735 targeting our repos).
 * rootId is a synthetic string (not a Nostr event ID).
 */
export interface RepoZapNotificationItem {
  kind: "repo-zap";
  /**
   * Synthetic root ID: "zaps:30617:<pubkey>:<dtag>"
   */
  rootId: string;
  /** The repo coordinate for this item */
  repoCoord: string;
  /** All zap receipt events in this group, sorted newest-first */
  events: NostrEvent[];
  /** Whether any event in this group is unread */
  unread: boolean;
  /** Whether this group is archived */
  archived: boolean;
  /** IDs of the specific events that are archived (subset of events[].id). */
  archivedEventIds: string[];
  /** Most recent event timestamp in this group */
  latestActivity: number;
  /** Unread event IDs, oldest-first */
  unreadEventIds: string[];
  /** Total sats zapped accumulated across all events in this group */
  totalSats: number;
}

/** Union of all notification item types */
export type NotificationItem =
  | ThreadNotificationItem
  | SocialNotificationItem
  | RepoZapNotificationItem;

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

export const DEFAULT_READ_STATE: NotificationReadState = {
  rb: 0,
  ri: [],
  ab: 0,
  ai: [],
};

// ---------------------------------------------------------------------------
// Thread filters
// ---------------------------------------------------------------------------

/**
 * Minimal filters for the navbar badge — limit:10 per filter, no since.
 *
 * Just enough to show a dot indicator without pulling history. The full
 * history fetch (buildNotificationFilters via ManualTimelineLoader) fires
 * only when the user visits the notifications page.
 */
export function buildNotificationBadgeFilters(pubkey: string): Filter[] {
  return [
    {
      kinds: [COMMENT_KIND],
      "#P": [pubkey],
      "#K": NIP34_ROOT_KINDS.map(String),
      limit: 10,
    } as Filter,
    {
      kinds: [
        ISSUE_KIND,
        PR_KIND,
        PATCH_KIND,
        PR_UPDATE_KIND,
        COVER_NOTE_KIND,
        ...STATUS_KINDS,
        LEGACY_REPLY_KIND,
      ],
      "#p": [pubkey],
      limit: 10,
    } as Filter,
    // Zap receipts where we are the recipient and the zap targets an event
    // (i.e. has an #e tag). Note: we do NOT filter by #k here — the k tag is
    // in the zap *request*, not the receipt, and is not reliably copied to the
    // receipt by all LNURL servers. Client-side routing in
    // getNotificationRootId handles the absent-k case by falling through to
    // the #e tag, and groupNotifications skips receipts with no resolvable
    // root (e.g. profile zaps with no #e).
    {
      kinds: [ZAP_RECEIPT_KIND],
      "#p": [pubkey],
      limit: 10,
    } as Filter,
  ];
}

/**
 * Build relay filters for thread notification events targeting a pubkey.
 *
 * Three filters:
 *   1. NIP-22 comments on NIP-34 root events authored by us (#P + #K)
 *   2. Events that tag us directly (#p) — new issues, PRs, patches,
 *      PR updates (kind:1619), status changes (kinds:1630–1633), cover notes
 *      (kind:1624), and kind:1622 legacy NIP-34 replies. Kind:1 generic text
 *      notes are intentionally excluded — they are not git-related and would
 *      flood notifications with unrelated Nostr mentions.
 *   3. NIP-57 zap receipts (kind:9735) where we are the recipient (#p) and
 *      the zapped event is a NIP-34 root item or a NIP-22 comment (#k).
 *      Repo-coord-targeted zaps (#k=30617) are fetched separately via
 *      buildRepoZapFilter — excluded here to avoid double-counting.
 *
 * @param pubkey - The user's pubkey
 * @param since  - If provided, only fetch events after this Unix timestamp
 *                 (used when we have a known read-before cutoff so we skip
 *                 already-read history). When absent a relay-side limit of
 *                 50 is used instead — avoids pulling unbounded history for
 *                 new users while still surfacing older notifications that
 *                 predate any 30-day window.
 */
export function buildNotificationFilters(
  pubkey: string,
  since?: number,
): Filter[] {
  // When we have a read cutoff, fetch everything after it (no limit needed).
  // When we don't, cap at 50 events per filter so we don't flood the connection
  // on first login — the user can load more by visiting the notifications page.
  const timeConstraint: Partial<Filter> = since ? { since } : { limit: 50 };

  return [
    // Comments on our issues/PRs/patches
    {
      kinds: [COMMENT_KIND],
      "#P": [pubkey],
      "#K": NIP34_ROOT_KINDS.map(String),
      ...timeConstraint,
    } as Filter,
    // Events that tag us directly (git-related kinds only)
    {
      kinds: [
        ISSUE_KIND,
        PR_KIND,
        PATCH_KIND,
        PR_UPDATE_KIND,
        COVER_NOTE_KIND,
        ...STATUS_KINDS,
        LEGACY_REPLY_KIND,
      ],
      "#p": [pubkey],
      ...timeConstraint,
    } as Filter,
    // Zap receipts where we are the recipient. No #k filter — see comment in
    // buildNotificationBadgeFilters for rationale.
    {
      kinds: [ZAP_RECEIPT_KIND],
      "#p": [pubkey],
      ...timeConstraint,
    } as Filter,
  ];
}

// ---------------------------------------------------------------------------
// Social filters
// ---------------------------------------------------------------------------

/**
 * Filter for kind:7 reactions (stars) targeting our repo announcements.
 * Requires knowing the repo coords.
 *
 * @param repoCoords - The repo coordinates to filter by
 * @param since      - If provided, only fetch events after this Unix timestamp.
 *                     When absent a limit of 50 is applied per the same
 *                     rationale as buildNotificationFilters.
 */
export function buildRepoStarFilter(
  repoCoords: string[],
  since?: number,
): Filter {
  const timeConstraint: Partial<Filter> = since ? { since } : { limit: 50 };
  return {
    kinds: [REACTION_KIND],
    "#k": [String(REPO_KIND)],
    "#a": repoCoords,
    ...timeConstraint,
  } as Filter;
}

/**
 * Filter for kind:9735 zap receipts targeting our repo announcements.
 * Requires knowing the repo coords.
 *
 * @param repoCoords - The repo coordinates to filter by
 * @param since      - If provided, only fetch events after this Unix timestamp.
 *                     When absent a limit of 50 is applied.
 */
export function buildRepoZapFilter(
  repoCoords: string[],
  since?: number,
): Filter {
  const timeConstraint: Partial<Filter> = since ? { since } : { limit: 50 };
  // Note: we do NOT include "#k" here. Per NIP-57 Appendix E, the zap receipt
  // only copies p/e/a/P from the zap request; the k tag is in the request only
  // and is not reliably propagated to the receipt by all LNURL servers.
  // The #a coord filter alone is sufficient to identify repo zaps.
  return {
    kinds: [ZAP_RECEIPT_KIND],
    "#a": repoCoords,
    ...timeConstraint,
  } as Filter;
}

// ---------------------------------------------------------------------------
// Thread grouping
// ---------------------------------------------------------------------------

/**
 * Follow NIP-10/NIP-22 parent pointers until reaching a root item.
 *
 * Comment-root pointers should normally reference the thread root directly,
 * but following locally known chains makes grouping robust to malformed or
 * legacy nested pointers. A loop falls back to the initial comment ID, rather
 * than allowing a cyclic event graph to make the notification disappear.
 */
function resolveThreadRootId(
  eventId: string,
  threadEvents?: Map<string, NostrEvent>,
): string {
  if (!threadEvents) return eventId;

  const seen = new Set<string>();
  let rootId = eventId;
  while (true) {
    if (seen.has(rootId)) return eventId;
    seen.add(rootId);

    const event = threadEvents.get(rootId);
    if (!event) return rootId;
    if (event.kind === ISSUE_KIND || event.kind === PR_KIND) return rootId;

    const nextRootId = getParentId(event);
    if (event.kind === PATCH_KIND && !nextRootId) return rootId;
    if (!nextRootId) return rootId;
    rootId = nextRootId;
  }
}

/**
 * Index events and every locally available parent needed to resolve a thread
 * root. Callers provide the store-specific synchronous event lookup.
 */
export function buildThreadEventMap(
  events: Iterable<NostrEvent>,
  getEvent: (id: string) => NostrEvent | undefined,
): Map<string, NostrEvent> {
  const threadEvents = new Map([...events].map((event) => [event.id, event]));
  const pendingEvents = [...threadEvents.values()];

  while (pendingEvents.length > 0) {
    const event = pendingEvents.pop();
    if (!event) continue;

    const parentId = getParentId(event);
    if (parentId && !threadEvents.has(parentId)) {
      const parent = getEvent(parentId);
      if (parent) {
        threadEvents.set(parent.id, parent);
        pendingEvents.push(parent);
      }
    }
  }

  return threadEvents;
}

/**
 * Extract the root issue/PR/patch event ID from a thread notification event.
 *
 * - If the event IS a root (issue/PR/patch kind), its own ID is the root.
 * - If it's a NIP-22 comment, the uppercase E root pointer is the root.
 * - If it's a PR update (kind:1619), the uppercase E tag is the root PR.
 * - If it's a status change (kinds:1630–1633), the NIP-10 root #e tag is the root.
 * - If it's a legacy reply (kind:1622), the NIP-10 root #e tag is the root.
 * - If it's a zap receipt (kind:9735):
 *     - #a tag present (addressable-event zap) → returns undefined (repo zaps
 *       are social notifications; other addressable kinds are not tracked here)
 *     - #k in NIP34_ROOT_KINDS → #e is the root item ID. #k is read from the
 *       embedded zap request first (always set by the client), falling back to
 *       the receipt's own #k tag.
 *     - #k = COMMENT_KIND → recursively follow the zapped comment's NIP-22
 *       and NIP-10 parent pointers, falling back to #e if unavailable.
 *     - #k is any other known kind (e.g. kind:1) → returns undefined (not a
 *       git notification; prevents zaps on regular Nostr notes from appearing)
 *     - #k absent in both request and receipt → falls through to #e
 * - Returns undefined if no root can be determined.
 */
export function getNotificationRootId(
  ev: NostrEvent,
  threadEvents?: Map<string, NostrEvent>,
): string | undefined {
  // Issues and PRs are always roots — their own ID
  if (ev.kind === ISSUE_KIND || ev.kind === PR_KIND) {
    return ev.id;
  }

  // Patches (kind:1617) can be either a root patch or a child patch (commit).
  // A child patch has an #e tag pointing to the root patch event ID.
  // A root patch has no such #e tag — its own ID is the root.
  if (ev.kind === PATCH_KIND) {
    const parentPatchId = ev.tags.find(([t]) => t === "e")?.[1];
    return parentPatchId
      ? resolveThreadRootId(parentPatchId, threadEvents)
      : ev.id;
  }

  // NIP-22 comment — uppercase E root pointer
  if (ev.kind === COMMENT_KIND) {
    const rootPointer = getCommentRootPointer(ev);
    return rootPointer &&
      "id" in rootPointer &&
      typeof rootPointer.id === "string"
      ? resolveThreadRootId(rootPointer.id, threadEvents)
      : undefined;
  }

  // PR update (kind:1619) — uppercase E tag points to the root PR
  if (ev.kind === PR_UPDATE_KIND) {
    const rootId = ev.tags.find(([t]) => t === "E")?.[1];
    return rootId ? resolveThreadRootId(rootId, threadEvents) : undefined;
  }

  // NIP-57 zap receipt (kind:9735) — route by the zapped event kind
  if (ev.kind === ZAP_RECEIPT_KIND) {
    // Addressable-event zap (#a tag present) — the coordinate encodes the
    // kind directly. Repo zaps (REPO_KIND) are social notifications handled
    // separately; any other addressable kind is not a thread item we track.
    const addrPointer = getZapAddressPointer(ev);
    if (addrPointer !== null) return undefined;

    // Read the zapped event kind from the embedded zap request first (the
    // request always carries the #k tag because the client sets it), then
    // fall back to the receipt's own #k tag for servers that copy it.
    const zapRequest = getZapRequest(ev);
    const k =
      zapRequest?.tags.find(([t]) => t === "k")?.[1] ??
      ev.tags.find(([t]) => t === "k")?.[1];

    const eventPointer = getZapEventPointer(ev);
    const e = eventPointer?.id;

    // Zapping a NIP-34 root item → #e IS the thread root
    if (
      k !== undefined &&
      NIP34_ROOT_KINDS.includes(
        Number(k) as (typeof NIP34_ROOT_KINDS)[number],
      ) &&
      e
    ) {
      return e;
    }

    // Zapping a NIP-22 comment → resolve its uppercase E thread-root pointer.
    // Fall back to the comment ID until the zapped comment is available.
    if (k === String(COMMENT_KIND) && e) {
      return resolveThreadRootId(e, threadEvents);
    }

    // If #k is explicitly set to a non-NIP-34, non-comment kind (e.g. kind:1),
    // this is a zap on an unrelated Nostr event — not a git notification.
    // Only fall through to return #e when #k is absent (some LNURL servers
    // don't copy the k tag from the zap request to the receipt, and the
    // embedded zap request may also lack it in rare cases).
    if (k !== undefined) return undefined;

    return e;
  }

  // Status changes (kinds:1630–1633) and legacy NIP-34 replies (kind:1622)
  // both use the NIP-10 root #e tag to reference their target.
  const nip10 = getNip10References(ev);
  return nip10.root?.e?.id
    ? resolveThreadRootId(nip10.root.e.id, threadEvents)
    : undefined;
}

// ---------------------------------------------------------------------------
// Read/archived state helpers
// ---------------------------------------------------------------------------

/** Check if a single event is read */
export function isEventRead(
  ev: NostrEvent,
  state: NotificationReadState,
  readIdSet: Set<string>,
): boolean {
  return ev.created_at <= state.rb || readIdSet.has(ev.id);
}

/** Check if a single event is archived */
export function isEventArchived(
  ev: NostrEvent,
  state: NotificationReadState,
  archivedIdSet: Set<string>,
): boolean {
  return ev.created_at <= state.ab || archivedIdSet.has(ev.id);
}

// ---------------------------------------------------------------------------
// Thread grouping
// ---------------------------------------------------------------------------

/**
 * Group thread notification events by root ID and compute read/archived status.
 *
 * Returns items sorted by latestActivity (newest first).
 * Events from the user's own pubkey are excluded.
 *
 * @param threadEvents - Locally available events indexed by ID. Their NIP-10
 *   and NIP-22 parent pointers are recursively traversed for grouping.
 */
export function groupNotifications(
  events: NostrEvent[],
  state: NotificationReadState,
  selfPubkey: string,
  threadEvents?: Map<string, NostrEvent>,
  nonGitEventIds?: Set<string>,
): ThreadNotificationItem[] {
  const readIdSet = new Set(state.ri);
  const archivedIdSet = new Set(state.ai);

  // Group by root ID, excluding self-authored events
  const groups = new Map<
    string,
    { events: NostrEvent[]; latestActivity: number }
  >();

  for (const ev of events) {
    if (ev.pubkey === selfPubkey) continue;

    // Skip events pending async root-kind resolution (ambiguous zap receipts
    // with no #k tag). They are held back until confirmed as git-related.
    if (nonGitEventIds?.has(ev.id)) continue;

    const rootId = getNotificationRootId(ev, threadEvents);
    if (!rootId) continue;

    const group = groups.get(rootId) ?? { events: [], latestActivity: 0 };
    group.events.push(ev);
    if (ev.created_at > group.latestActivity) {
      group.latestActivity = ev.created_at;
    }
    groups.set(rootId, group);
  }

  // Build ThreadNotificationItems
  const items: ThreadNotificationItem[] = [];
  for (const [rootId, group] of groups) {
    // Sort events newest-first within each group
    group.events.sort((a, b) => b.created_at - a.created_at);

    const unreadEvents = group.events.filter(
      (ev) => !isEventRead(ev, state, readIdSet),
    );
    const unread = unreadEvents.length > 0;
    const archived = group.events.every((ev) =>
      isEventArchived(ev, state, archivedIdSet),
    );
    const archivedEventIds = group.events
      .filter((ev) => isEventArchived(ev, state, archivedIdSet))
      .map((ev) => ev.id);

    // unreadEvents is already newest-first (filtered from group.events which is
    // sorted newest-first), so reversing gives oldest-first IDs without a
    // second sort pass.
    const unreadEventIds = unreadEvents.map((ev) => ev.id).reverse();

    items.push({
      kind: "thread",
      rootId,
      events: group.events,
      unread,
      archived,
      archivedEventIds,
      latestActivity: group.latestActivity,
      unreadEventIds,
    });
  }

  // Sort by latest activity, newest first
  items.sort((a, b) => b.latestActivity - a.latestActivity);
  return items;
}

// ---------------------------------------------------------------------------
// Social grouping
// ---------------------------------------------------------------------------

/**
 * Group repo-star events (kind:7) into one SocialNotificationItem per repo.
 *
 * Builds a Map<coord, events[]> in a single pass over repoStarEvents (O(n))
 * rather than filtering per-coord (O(n×m)).
 *
 * @param repoStarEvents  kind:7 reactions targeting our repos
 * @param repoCoords      our own repo coordinates (used to validate grouping)
 */
export function groupSocialNotifications(
  repoStarEvents: NostrEvent[],
  repoCoords: string[],
  state: NotificationReadState,
  selfPubkey: string,
): SocialNotificationItem[] {
  if (repoStarEvents.length === 0 || repoCoords.length === 0) return [];

  const readIdSet = new Set(state.ri);
  const archivedIdSet = new Set(state.ai);
  const coordSet = new Set(repoCoords);

  // Build coord → events map in a single O(n) pass
  const byCoord = new Map<string, NostrEvent[]>();
  for (const ev of repoStarEvents) {
    if (ev.pubkey === selfPubkey) continue;
    for (const [t, v] of ev.tags) {
      if (t === "a" && coordSet.has(v)) {
        const bucket = byCoord.get(v);
        if (bucket) {
          bucket.push(ev);
        } else {
          byCoord.set(v, [ev]);
        }
        break; // each event belongs to at most one coord group
      }
    }
  }

  const items: SocialNotificationItem[] = [];

  for (const [coord, events] of byCoord) {
    // Sort newest-first
    events.sort((a, b) => b.created_at - a.created_at);

    const latestActivity = events[0]?.created_at ?? 0;
    const unreadEvents = events.filter(
      (ev) => !isEventRead(ev, state, readIdSet),
    );
    const unread = unreadEvents.length > 0;
    const archived = events.every((ev) =>
      isEventArchived(ev, state, archivedIdSet),
    );
    const archivedEventIds = events
      .filter((ev) => isEventArchived(ev, state, archivedIdSet))
      .map((ev) => ev.id);
    // unreadEvents is newest-first; reverse gives oldest-first IDs
    const unreadEventIds = unreadEvents.map((ev) => ev.id).reverse();

    items.push({
      kind: "repo-star",
      rootId: `${REPO_STARS_PREFIX}${coord}`,
      repoCoord: coord,
      events,
      unread,
      archived,
      archivedEventIds,
      latestActivity,
      unreadEventIds,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Repo zap grouping
// ---------------------------------------------------------------------------

/**
 * Group repo-zap events (kind:9735) into one RepoZapNotificationItem per repo.
 *
 * Mirrors the structure of groupSocialNotifications. Filters to events that
 * have an #a tag matching one of the user's repo coordinates and where the
 * sender is not the recipient (no self-zap notifications).
 *
 * @param repoZapEvents  kind:9735 receipts targeting our repos
 * @param repoCoords     our own repo coordinates (used to validate grouping)
 */
export function groupRepoZapNotifications(
  repoZapEvents: NostrEvent[],
  repoCoords: string[],
  state: NotificationReadState,
  selfPubkey: string,
): RepoZapNotificationItem[] {
  if (repoZapEvents.length === 0 || repoCoords.length === 0) return [];

  const readIdSet = new Set(state.ri);
  const archivedIdSet = new Set(state.ai);
  const coordSet = new Set(repoCoords);

  // Build coord → events map in a single O(n) pass
  const byCoord = new Map<string, NostrEvent[]>();
  for (const ev of repoZapEvents) {
    // Zap receipts are published by a lightning service; their sender is the
    // author of the embedded zap request.
    const senderPubkey = getZapSender(ev) ?? ev.pubkey;
    if (senderPubkey === selfPubkey) continue;

    for (const [t, v] of ev.tags) {
      if (t === "a" && coordSet.has(v)) {
        const bucket = byCoord.get(v);
        if (bucket) {
          bucket.push(ev);
        } else {
          byCoord.set(v, [ev]);
        }
        break; // each event belongs to at most one coord group
      }
    }
  }

  const items: RepoZapNotificationItem[] = [];

  for (const [coord, events] of byCoord) {
    // Sort newest-first
    events.sort((a, b) => b.created_at - a.created_at);

    const latestActivity = events[0]?.created_at ?? 0;
    const unreadEvents = events.filter(
      (ev) => !isEventRead(ev, state, readIdSet),
    );
    const unread = unreadEvents.length > 0;
    const archived = events.every((ev) =>
      isEventArchived(ev, state, archivedIdSet),
    );
    const archivedEventIds = events
      .filter((ev) => isEventArchived(ev, state, archivedIdSet))
      .map((ev) => ev.id);
    // unreadEvents is newest-first; reverse gives oldest-first IDs
    const unreadEventIds = unreadEvents.map((ev) => ev.id).reverse();

    // Sum sats across all zap receipts in this group via the bolt11 invoice.
    let totalSats = 0;
    for (const ev of events) {
      const msats = getZapAmount(ev) ?? 0;
      if (msats > 0) totalSats += Math.floor(msats / 1000);
    }

    items.push({
      kind: "repo-zap",
      rootId: `${REPO_ZAPS_PREFIX}${coord}`,
      repoCoord: coord,
      events,
      unread,
      archived,
      archivedEventIds,
      latestActivity,
      unreadEventIds,
      totalSats,
    });
  }

  return items;
}

/**
 * Advance the read cutoff and prune the ID array.
 *
 * Algorithm (same as gitworkshop):
 *   1. Find the oldest unread event
 *   2. Set cutoff to min(oldest_unread - 1, now - 3 days)
 *   3. Prune IDs older than the new cutoff
 */
export function advanceReadCutoff(
  events: NostrEvent[],
  state: NotificationReadState,
  selfPubkey: string,
): Pick<NotificationReadState, "rb" | "ri"> {
  // #5: build O(1) lookup map once instead of O(n) find() per ID
  const eventById = new Map<string, NostrEvent>(events.map((e) => [e.id, e]));
  const readIdSet = new Set(state.ri);
  const threeDaysAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 3;

  // Find oldest unread event (excluding self)
  let oldestUnreadAt = Infinity;
  for (const ev of events) {
    if (ev.pubkey === selfPubkey) continue;
    if (!isEventRead(ev, state, readIdSet)) {
      if (ev.created_at < oldestUnreadAt) {
        oldestUnreadAt = ev.created_at;
      }
    }
  }

  let newRb: number;
  if (oldestUnreadAt !== Infinity && oldestUnreadAt < threeDaysAgo) {
    newRb = oldestUnreadAt - 1;
  } else {
    newRb = threeDaysAgo;
  }

  // Never let the cutoff go backwards — only advance it.
  newRb = Math.max(newRb, state.rb);

  // Prune IDs older than the new cutoff — O(1) per ID via Map
  const newRi = state.ri.filter((id) => {
    const ev = eventById.get(id);
    return ev && ev.created_at >= newRb;
  });

  return { rb: newRb, ri: newRi };
}

/**
 * Advance the archived cutoff and prune the ID array.
 * Same algorithm as advanceReadCutoff but for archived state.
 */
export function advanceArchivedCutoff(
  events: NostrEvent[],
  state: NotificationReadState,
  selfPubkey: string,
): Pick<NotificationReadState, "ab" | "ai"> {
  // #5: build O(1) lookup map once instead of O(n) find() per ID
  const eventById = new Map<string, NostrEvent>(events.map((e) => [e.id, e]));
  const archivedIdSet = new Set(state.ai);
  const threeDaysAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 3;

  let oldestUnarchivedAt = Infinity;
  for (const ev of events) {
    if (ev.pubkey === selfPubkey) continue;
    if (!isEventArchived(ev, state, archivedIdSet)) {
      if (ev.created_at < oldestUnarchivedAt) {
        oldestUnarchivedAt = ev.created_at;
      }
    }
  }

  let newAb: number;
  if (oldestUnarchivedAt !== Infinity && oldestUnarchivedAt < threeDaysAgo) {
    newAb = oldestUnarchivedAt - 1;
  } else {
    newAb = threeDaysAgo;
  }

  // Never let the cutoff go backwards — only advance it.
  newAb = Math.max(newAb, state.ab);

  // Prune IDs older than the new cutoff — O(1) per ID via Map
  const newAi = state.ai.filter((id) => {
    const ev = eventById.get(id);
    return ev && ev.created_at >= newAb;
  });

  return { ab: newAb, ai: newAi };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Validate and parse a NotificationReadState from JSON */
export function parseReadState(json: unknown): NotificationReadState {
  if (
    typeof json === "object" &&
    json !== null &&
    "rb" in json &&
    "ri" in json &&
    "ab" in json &&
    "ai" in json
  ) {
    const obj = json as Record<string, unknown>;
    return {
      rb: typeof obj.rb === "number" ? obj.rb : 0,
      ri: Array.isArray(obj.ri)
        ? obj.ri.filter((v): v is string => typeof v === "string")
        : [],
      ab: typeof obj.ab === "number" ? obj.ab : 0,
      ai: Array.isArray(obj.ai)
        ? obj.ai.filter((v): v is string => typeof v === "string")
        : [],
    };
  }
  return { ...DEFAULT_READ_STATE };
}

/**
 * Merge two read states, taking the more-recent cutoff and unioning the
 * ID arrays. Used when reconciling localStorage (fast) with NIP-78 (relay).
 */
export function mergeReadStates(
  a: NotificationReadState,
  b: NotificationReadState,
): NotificationReadState {
  return {
    rb: Math.max(a.rb, b.rb),
    ri: [...new Set([...a.ri, ...b.ri])],
    ab: Math.max(a.ab, b.ab),
    ai: [...new Set([...a.ai, ...b.ai])],
  };
}
