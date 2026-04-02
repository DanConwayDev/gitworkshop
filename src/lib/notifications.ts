/**
 * Notification system — constants, types, filters, and grouping logic.
 *
 * Two categories of notifications:
 *
 * Thread notifications — activity on issues/PRs/patches:
 *   1. NIP-22 comments (kind:1111) on issues/PRs/patches authored by us
 *      (uppercase #P tag + #K filter for NIP-34 root kinds)
 *   2. New issues/PRs/patches/PR-updates/status-changes that tag us via #p
 *      (someone filed an issue on our repo, pushed a PR update, closed an
 *      issue we authored, etc.)
 *   3. Legacy NIP-34 replies (kind:1622) that tag us via #p
 *
 * Social notifications — repo stars:
 *   4. kind:7 reactions with content "+" targeting our repos (#k:30617, #a)
 *
 * Social items are grouped:
 *   - Repo stars → one item per repo, rootId "stars:<repoCoord>"
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
  PR_UPDATE_KIND,
  COMMENT_KIND,
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

/** Prefix for repo-star notification rootIds */
export const REPO_STARS_PREFIX = "stars:";

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
  /** Most recent event timestamp in this group */
  latestActivity: number;
  /** Unread event IDs, oldest-first */
  unreadEventIds: string[];
}

/** Union of all notification item types */
export type NotificationItem = ThreadNotificationItem | SocialNotificationItem;

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
        ...STATUS_KINDS,
        LEGACY_REPLY_KIND,
      ],
      "#p": [pubkey],
      limit: 10,
    } as Filter,
  ];
}

/**
 * Build relay filters for thread notification events targeting a pubkey.
 *
 * Two filters:
 *   1. NIP-22 comments on NIP-34 root events authored by us (#P + #K)
 *   2. Events that tag us directly (#p) — new issues, PRs, patches,
 *      PR updates (kind:1619), status changes (kinds:1630–1633), and
 *      kind:1622 legacy NIP-34 replies. Kind:1 generic text notes are
 *      intentionally excluded — they are not git-related and would flood
 *      notifications with unrelated Nostr mentions.
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
        ...STATUS_KINDS,
        LEGACY_REPLY_KIND,
      ],
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

// ---------------------------------------------------------------------------
// Thread grouping
// ---------------------------------------------------------------------------

/**
 * Extract the root issue/PR/patch event ID from a thread notification event.
 *
 * - If the event IS a root (issue/PR/patch kind), its own ID is the root.
 * - If it's a NIP-22 comment, the uppercase E root pointer is the root.
 * - If it's a PR update (kind:1619), the uppercase E tag is the root PR.
 * - If it's a status change (kinds:1630–1633), the NIP-10 root #e tag is the root.
 * - If it's a legacy reply (kind:1622), the NIP-10 root #e tag is the root.
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

  // PR update (kind:1619) — uppercase E tag points to the root PR
  if (ev.kind === PR_UPDATE_KIND) {
    return ev.tags.find(([t]) => t === "E")?.[1];
  }

  // Status changes (kinds:1630–1633) and legacy NIP-34 replies (kind:1622)
  // both use the NIP-10 root #e tag to reference their target.
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

// ---------------------------------------------------------------------------
// Thread grouping
// ---------------------------------------------------------------------------

/**
 * Group thread notification events by root ID and compute read/archived status.
 *
 * Returns items sorted by latestActivity (newest first).
 * Events from the user's own pubkey are excluded.
 */
export function groupNotifications(
  events: NostrEvent[],
  state: NotificationReadState,
  selfPubkey: string,
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

    const rootId = getNotificationRootId(ev);
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
    // unreadEvents is newest-first; reverse gives oldest-first IDs
    const unreadEventIds = unreadEvents.map((ev) => ev.id).reverse();

    items.push({
      kind: "repo-star",
      rootId: `${REPO_STARS_PREFIX}${coord}`,
      repoCoord: coord,
      events,
      unread,
      archived,
      latestActivity,
      unreadEventIds,
    });
  }

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
