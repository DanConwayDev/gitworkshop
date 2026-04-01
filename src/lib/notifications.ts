/**
 * Notification system — constants, types, filters, and grouping logic.
 *
 * Notifications are events that reference the current user:
 *   1. NIP-22 comments (kind:1111) on issues/PRs/patches authored by us
 *      (uppercase #P tag + #K filter for NIP-34 root kinds)
 *   2. New issues/PRs/patches that tag us via #p (someone filed an issue
 *      on our repo, tagged us in a PR, etc.)
 *   3. Legacy replies (kind:1, kind:1622) that tag us via #p
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
} from "applesauce-common/helpers";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  COMMENT_KIND,
  LEGACY_REPLY_KINDS,
} from "@/lib/nip34";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NIP-78 kind for arbitrary app data */
export const NIP78_KIND = 30078;

/** d-tag for our notification read-state event */
export const NOTIFICATION_STATE_D_TAG = "git-notifications-state";

/** NIP-34 root kinds whose comments generate notifications */
export const NIP34_ROOT_KINDS = [PATCH_KIND, PR_KIND, ISSUE_KIND] as const;

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

/** A notification group — all events related to a single issue/PR/patch */
export interface NotificationItem {
  /** The root issue/PR/patch event ID this notification belongs to */
  rootId: string;
  /** All notification events for this root, sorted newest-first */
  events: NostrEvent[];
  /** Whether any event in this group is unread */
  unread: boolean;
  /** Whether this group is archived */
  archived: boolean;
  /** Most recent event timestamp in this group */
  latestActivity: number;
  /**
   * IDs of the specific events that are unread (subset of events[].id).
   * Sorted oldest-first so the first entry is the oldest unread event —
   * useful for anchor-scrolling to the first new content.
   */
  unreadEventIds: string[];
}

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
// Filters
// ---------------------------------------------------------------------------

/**
 * Build relay filters for notification events targeting a pubkey.
 *
 * Two filters (same as gitworkshop):
 *   1. NIP-22 comments on NIP-34 root events authored by us (#P + #K)
 *   2. Events that tag us directly (#p) — new issues, PRs, patches, legacy replies
 */
export function buildNotificationFilters(pubkey: string): Filter[] {
  return [
    // Comments on our issues/PRs/patches
    {
      kinds: [COMMENT_KIND],
      "#P": [pubkey],
      "#K": NIP34_ROOT_KINDS.map(String),
    } as Filter,
    // Events that tag us directly
    {
      kinds: [ISSUE_KIND, PR_KIND, PATCH_KIND, ...LEGACY_REPLY_KINDS],
      "#p": [pubkey],
    } as Filter,
  ];
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Extract the root issue/PR/patch event ID from a notification event.
 *
 * - If the event IS a root (issue/PR/patch kind), its own ID is the root.
 * - If it's a NIP-22 comment, the uppercase E root pointer is the root.
 * - If it's a legacy reply, the NIP-10 root #e tag is the root.
 * - Returns undefined if no root can be determined.
 */
export function getNotificationRootId(ev: NostrEvent): string | undefined {
  // Root events — their own ID
  if (ev.kind === ISSUE_KIND || ev.kind === PR_KIND || ev.kind === PATCH_KIND) {
    return ev.id;
  }

  // NIP-22 comment — uppercase E root pointer
  if (ev.kind === COMMENT_KIND) {
    const rootPointer = getCommentRootPointer(ev);
    return rootPointer && "id" in rootPointer ? rootPointer.id : undefined;
  }

  // Legacy replies (kind:1, kind:1622) — NIP-10 root #e tag
  const nip10 = getNip10References(ev);
  return nip10.root?.e?.id;
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

/**
 * Group notification events by root ID and compute read/archived status.
 *
 * Returns items sorted by latestActivity (newest first).
 * Events from the user's own pubkey are excluded.
 */
export function groupNotifications(
  events: NostrEvent[],
  state: NotificationReadState,
  selfPubkey: string,
): NotificationItem[] {
  const readIdSet = new Set(state.ri);
  const archivedIdSet = new Set(state.ai);

  // Group by root ID, excluding self-authored events
  const groups = new Map<
    string,
    { events: NostrEvent[]; latestActivity: number }
  >();

  for (const ev of events) {
    if (ev.pubkey === selfPubkey) continue;

    const rootId = getNotificationRootId(ev);
    if (!rootId) continue;

    const group = groups.get(rootId) ?? { events: [], latestActivity: 0 };
    group.events.push(ev);
    if (ev.created_at > group.latestActivity) {
      group.latestActivity = ev.created_at;
    }
    groups.set(rootId, group);
  }

  // Build NotificationItems
  const items: NotificationItem[] = [];
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

    // unreadEvents is already newest-first (filtered from group.events which is
    // sorted newest-first), so reversing gives oldest-first IDs without a
    // second sort pass.
    const unreadEventIds = unreadEvents.map((ev) => ev.id).reverse();

    items.push({
      rootId,
      events: group.events,
      unread,
      archived,
      latestActivity: group.latestActivity,
      unreadEventIds,
    });
  }

  // Sort by latest activity, newest first
  items.sort((a, b) => b.latestActivity - a.latestActivity);
  return items;
}

// ---------------------------------------------------------------------------
// Cutoff advancement
// ---------------------------------------------------------------------------

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
