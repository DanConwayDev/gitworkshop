/**
 * Shared pure utilities for notification display logic.
 * Used by both NotificationsPage and the Dashboard compact panel.
 */

import type {
  NotificationItem,
  SocialNotificationItem,
} from "@/lib/notifications";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  COMMENT_KIND,
  COVER_NOTE_KIND,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_OPEN,
  STATUS_DRAFT,
  PR_UPDATE_KIND,
} from "@/lib/nip34";

// ---------------------------------------------------------------------------
// Root type inference
// ---------------------------------------------------------------------------

export function inferRootType(
  item: NotificationItem,
): "issue" | "pr" | "patch" | "unknown" {
  for (const ev of item.events) {
    if (ev.kind === ISSUE_KIND) return "issue";
    if (ev.kind === PR_KIND) return "pr";
    if (ev.kind === PATCH_KIND) return "patch";
  }
  // Check #K tags on NIP-22 comments
  for (const ev of item.events) {
    const kTag = ev.tags.find(([t]) => t === "K")?.[1];
    if (kTag === String(ISSUE_KIND)) return "issue";
    if (kTag === String(PR_KIND)) return "pr";
    if (kTag === String(PATCH_KIND)) return "patch";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

export function titleFromEvent(ev: {
  kind: number;
  tags: string[][];
  content: string;
}): string | undefined {
  if (ev.kind !== ISSUE_KIND && ev.kind !== PR_KIND && ev.kind !== PATCH_KIND) {
    return undefined;
  }
  const subject = ev.tags.find(([t]) => t === "subject")?.[1];
  if (subject) return subject;
  const desc = ev.tags.find(([t]) => t === "description")?.[1];
  if (desc) {
    const firstLine = desc.split("\n")[0];
    if (firstLine) return firstLine;
  }
  const firstLine = ev.content.split("\n")[0];
  if (firstLine) return firstLine.slice(0, 80);
  return undefined;
}

/** Derive the display title from the root event + notification group events. */
export function resolveTitle(
  rootEvent: { kind: number; tags: string[][]; content: string } | undefined,
  item: NotificationItem,
): string {
  if (rootEvent) {
    const title = titleFromEvent(rootEvent);
    if (title) return title;
  }
  // Fast path: root event is already in the notification group
  for (const ev of item.events) {
    const title = titleFromEvent(ev);
    if (title) return title;
  }
  return `Activity on ${item.rootId.slice(0, 8)}...`;
}

// ---------------------------------------------------------------------------
// Repo coord resolution
// ---------------------------------------------------------------------------

/** Derive the repo coord from the root event + notification group events. */
export function resolveRepoCoord(
  rootEvent: { tags: string[][] } | undefined,
  item: NotificationItem | SocialNotificationItem,
): string | undefined {
  if (rootEvent) {
    const aTag = rootEvent.tags.find(([t]) => t === "a")?.[1];
    if (aTag?.startsWith("30617:")) return aTag;
  }
  for (const ev of item.events) {
    const aTag = ev.tags.find(([t]) => t === "a")?.[1];
    if (aTag?.startsWith("30617:")) return aTag;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Notification summary
// ---------------------------------------------------------------------------

export interface NotificationSummary {
  /** Always-visible purpose label, e.g. "new issue", "new PR" */
  purpose: string | undefined;
  /** Unread activity text, e.g. "merged", "3 new comments" */
  unreadText: string | undefined;
  hasMerge: boolean;
  hasClosed: boolean;
}

export function buildNotificationSummary(
  item: NotificationItem,
): NotificationSummary {
  let purpose: string | undefined;
  let hasNewCommits = false;

  for (const ev of item.events) {
    if (ev.kind === ISSUE_KIND) {
      purpose = "new issue";
      break;
    }
    if (ev.kind === PR_KIND) {
      purpose = "new PR";
      break;
    }
    if (ev.kind === PATCH_KIND) {
      purpose = "new patch";
      break;
    }
    if (ev.kind === PR_UPDATE_KIND) {
      hasNewCommits = true;
    }
  }

  if (!purpose && hasNewCommits) {
    purpose = "new commits pushed";
  }

  if (!item.unread || item.unreadEventIds.length === 0) {
    return {
      purpose,
      unreadText: undefined,
      hasMerge: false,
      hasClosed: false,
    };
  }

  const unreadIdSet = new Set(item.unreadEventIds);
  const unreadEvents = item.events.filter((ev) => unreadIdSet.has(ev.id));

  let commentCount = 0;
  let coverNoteCount = 0;
  let merged = false;
  let closed = false;
  let reopened = false;
  let drafted = false;
  let newRevision = false;

  for (const ev of unreadEvents) {
    if (ev.kind === COVER_NOTE_KIND) {
      coverNoteCount++;
    } else if (ev.kind === COMMENT_KIND || ev.kind === 1 || ev.kind === 1622) {
      commentCount++;
    } else if (ev.kind === STATUS_RESOLVED) {
      merged = true;
    } else if (ev.kind === STATUS_CLOSED) {
      closed = true;
    } else if (ev.kind === STATUS_OPEN) {
      reopened = true;
    } else if (ev.kind === STATUS_DRAFT) {
      drafted = true;
    } else if (ev.kind === PR_UPDATE_KIND) {
      newRevision = true;
    }
  }

  // drafted is tracked but currently has no separate output label
  void drafted;

  const parts: string[] = [];
  if (merged) parts.push("merged");
  else if (closed) parts.push("closed");
  else if (reopened) parts.push("reopened");
  if (newRevision) parts.push("new revision");
  if (commentCount > 0) {
    parts.push(
      `${commentCount} new ${commentCount === 1 ? "comment" : "comments"}`,
    );
  }
  if (coverNoteCount > 0) {
    parts.push(
      `${coverNoteCount} cover ${coverNoteCount === 1 ? "note" : "notes"} updated`,
    );
  }

  const unreadText = parts.length > 0 ? parts.join(" · ") : undefined;
  return { purpose, unreadText, hasMerge: merged, hasClosed: closed };
}

// ---------------------------------------------------------------------------
// Link building
// ---------------------------------------------------------------------------

/**
 * Build the link path for a notification item, appending an `?unread=` query
 * param with the first 15 chars of each unread event ID (oldest-first).
 * The first ID is also used as the hash anchor so the page scrolls to the
 * oldest unread content.
 */
export function buildNotificationLink(
  nevent: string,
  item: NotificationItem,
): string {
  const base = `/${nevent}`;
  if (item.unreadEventIds.length === 0) return base;
  const anchors = item.unreadEventIds.map((id) => id.slice(0, 15));
  const params = new URLSearchParams({ unread: anchors.join(",") });
  return `${base}?${params.toString()}#${anchors[0]}`;
}

// ---------------------------------------------------------------------------
// Commenter pubkeys
// ---------------------------------------------------------------------------

export function getCommenters(item: NotificationItem): string[] {
  const pubkeys = new Set<string>();
  for (const ev of item.events) {
    pubkeys.add(ev.pubkey);
  }
  return Array.from(pubkeys).slice(0, 5);
}

export function getActorPubkeys(
  item: NotificationItem | SocialNotificationItem,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ev of item.events) {
    if (!seen.has(ev.pubkey)) {
      seen.add(ev.pubkey);
      result.push(ev.pubkey);
    }
  }
  return result;
}
