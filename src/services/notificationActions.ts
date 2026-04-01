/**
 * Notification action implementations.
 *
 * Pure functions that mutate the NotificationReadState via updateReadState().
 * They read current events synchronously from the EventStore — no stale refs,
 * no React dependency — so they are testable without rendering components.
 */

import {
  buildNotificationFilters,
  buildAuthorFollowFilter,
  buildRepoStarFilter,
  buildRepoFollowFilter,
  getNotificationRootId,
  isEventRead,
  isEventArchived,
  advanceReadCutoff,
  advanceArchivedCutoff,
  AUTHOR_FOLLOWS_ROOT_ID,
  REPO_STARS_PREFIX,
  REPO_FOLLOWS_PREFIX,
  type NotificationReadState,
} from "@/lib/notifications";
import { eventStore } from "@/services/nostr";
import type { NostrEvent } from "nostr-tools";
import type { NotificationStoreEntry } from "./notificationStore";
import { updateReadState } from "./notificationStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNotificationEvents(pubkey: string): NostrEvent[] {
  return eventStore.getByFilters(buildNotificationFilters(pubkey));
}

/**
 * Get all social notification events for a given synthetic rootId.
 * Returns the events that belong to that social group.
 */
function getSocialEventsForRootId(
  entry: NotificationStoreEntry,
  rootId: string,
): NostrEvent[] {
  const coords = entry.repoCoords$.getValue();

  if (rootId === AUTHOR_FOLLOWS_ROOT_ID) {
    return eventStore.getByFilters([
      buildAuthorFollowFilter(entry.pubkey),
    ]) as NostrEvent[];
  }

  if (rootId.startsWith(REPO_STARS_PREFIX)) {
    const coord = rootId.slice(REPO_STARS_PREFIX.length);
    if (!coords.includes(coord)) return [];
    return eventStore.getByFilters([
      buildRepoStarFilter([coord]),
    ]) as NostrEvent[];
  }

  if (rootId.startsWith(REPO_FOLLOWS_PREFIX)) {
    const coord = rootId.slice(REPO_FOLLOWS_PREFIX.length);
    if (!coords.includes(coord)) return [];
    return eventStore.getByFilters([
      buildRepoFollowFilter([coord]),
    ]) as NostrEvent[];
  }

  return [];
}

/**
 * Get all notification events (thread + social) for cutoff advancement.
 * Used by mark-all actions that need the full event set.
 */
function getAllNotificationEvents(entry: NotificationStoreEntry): NostrEvent[] {
  const coords = entry.repoCoords$.getValue();
  const thread = eventStore.getByFilters(
    buildNotificationFilters(entry.pubkey),
  ) as NostrEvent[];
  const authorFollows = eventStore.getByFilters([
    buildAuthorFollowFilter(entry.pubkey),
  ]) as NostrEvent[];
  const stars =
    coords.length > 0
      ? (eventStore.getByFilters([buildRepoStarFilter(coords)]) as NostrEvent[])
      : [];
  const follows =
    coords.length > 0
      ? (eventStore.getByFilters([
          buildRepoFollowFilter(coords),
        ]) as NostrEvent[])
      : [];
  return [...thread, ...authorFollows, ...stars, ...follows];
}

/** True if rootId is a synthetic social rootId (not a Nostr event ID) */
function isSocialRootId(rootId: string): boolean {
  return (
    rootId === AUTHOR_FOLLOWS_ROOT_ID ||
    rootId.startsWith(REPO_STARS_PREFIX) ||
    rootId.startsWith(REPO_FOLLOWS_PREFIX)
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Get the events belonging to a rootId, handling both thread and social. */
function getEventsForRootId(
  entry: NotificationStoreEntry,
  rootId: string,
): NostrEvent[] {
  if (isSocialRootId(rootId)) {
    return getSocialEventsForRootId(entry, rootId).filter(
      (ev) => ev.pubkey !== entry.pubkey,
    );
  }
  return getNotificationEvents(entry.pubkey).filter(
    (ev) => ev.pubkey !== entry.pubkey && getNotificationRootId(ev) === rootId,
  );
}

export function actionMarkAsRead(
  entry: NotificationStoreEntry,
  rootId: string,
): void {
  updateReadState(entry, (prev) => {
    const allEvents = getAllNotificationEvents(entry);
    const rootEvents = getEventsForRootId(entry, rootId);
    const readIdSet = new Set(prev.ri);
    const newlyReadIds = rootEvents
      .filter((ev) => !isEventRead(ev, prev, readIdSet))
      .map((ev) => ev.id);

    if (newlyReadIds.length === 0) return prev;

    const updated = { ...prev, ri: [...prev.ri, ...newlyReadIds] };
    const cutoff = advanceReadCutoff(allEvents, updated, entry.pubkey);
    return { ...updated, ...cutoff };
  });
}

export function actionMarkAsUnread(
  entry: NotificationStoreEntry,
  rootId: string,
): void {
  updateReadState(entry, (prev) => {
    const allEvents = getAllNotificationEvents(entry);
    const rootEvents = getEventsForRootId(entry, rootId);
    if (rootEvents.length === 0) return prev;

    const rootEventIds = new Set(rootEvents.map((ev) => ev.id));
    let newRi = prev.ri.filter((id) => !rootEventIds.has(id));

    const oldestInRoot = Math.min(...rootEvents.map((ev) => ev.created_at));
    let newRb = prev.rb;

    if (oldestInRoot <= prev.rb) {
      newRb = oldestInRoot - 1;
      const reMarkIds = allEvents
        .filter(
          (ev) =>
            ev.pubkey !== entry.pubkey &&
            ev.created_at >= newRb &&
            ev.created_at < prev.rb &&
            !rootEventIds.has(ev.id) &&
            !newRi.includes(ev.id),
        )
        .map((ev) => ev.id);
      newRi = [...newRi, ...reMarkIds];
    }

    const updated = { ...prev, rb: newRb, ri: newRi };
    const cutoff = advanceReadCutoff(allEvents, updated, entry.pubkey);
    return { ...updated, ...cutoff };
  });
}

export function actionMarkAsArchived(
  entry: NotificationStoreEntry,
  rootId: string,
): void {
  updateReadState(entry, (prev) => {
    const allEvents = getAllNotificationEvents(entry);
    const rootEvents = getEventsForRootId(entry, rootId);
    const archivedIdSet = new Set(prev.ai);

    const newlyArchivedIds = rootEvents
      .filter((ev) => !isEventArchived(ev, prev, archivedIdSet))
      .map((ev) => ev.id);

    if (newlyArchivedIds.length === 0) return prev;

    let updated = { ...prev, ai: [...prev.ai, ...newlyArchivedIds] };
    const archivedCutoff = advanceArchivedCutoff(
      allEvents,
      updated,
      entry.pubkey,
    );
    updated = { ...updated, ...archivedCutoff };

    // Archived items are always read too
    const readIdSet = new Set(updated.ri);
    const newlyReadIds = rootEvents
      .filter((ev) => !isEventRead(ev, updated, readIdSet))
      .map((ev) => ev.id);
    if (newlyReadIds.length > 0) {
      updated = { ...updated, ri: [...updated.ri, ...newlyReadIds] };
      const readCutoff = advanceReadCutoff(allEvents, updated, entry.pubkey);
      updated = { ...updated, ...readCutoff };
    }

    return updated;
  });
}

export function actionMarkAsUnarchived(
  entry: NotificationStoreEntry,
  rootId: string,
): void {
  updateReadState(entry, (prev) => {
    const allEvents = getAllNotificationEvents(entry);
    const rootEvents = getEventsForRootId(entry, rootId);
    if (rootEvents.length === 0) return prev;

    const rootEventIds = new Set(rootEvents.map((ev) => ev.id));
    let newAi = prev.ai.filter((id) => !rootEventIds.has(id));

    const oldestInRoot = Math.min(...rootEvents.map((ev) => ev.created_at));
    let newAb = prev.ab;

    if (oldestInRoot <= prev.ab) {
      newAb = oldestInRoot - 1;
      const reMarkIds = allEvents
        .filter(
          (ev) =>
            ev.pubkey !== entry.pubkey &&
            ev.created_at >= newAb &&
            ev.created_at < prev.ab &&
            !rootEventIds.has(ev.id) &&
            !newAi.includes(ev.id),
        )
        .map((ev) => ev.id);
      newAi = [...newAi, ...reMarkIds];
    }

    const updated = { ...prev, ab: newAb, ai: newAi };
    const cutoff = advanceArchivedCutoff(allEvents, updated, entry.pubkey);
    return { ...updated, ...cutoff };
  });
}

export function actionMarkAllAsRead(entry: NotificationStoreEntry): void {
  updateReadState(entry, (prev) => {
    const events = getAllNotificationEvents(entry);
    const self = entry.pubkey;
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 10;
    const newRi = events
      .filter((ev) => ev.pubkey !== self && ev.created_at > tenDaysAgo)
      .map((ev) => ev.id);
    return { ...prev, rb: tenDaysAgo, ri: newRi };
  });
}

export function actionMarkAllAsArchived(entry: NotificationStoreEntry): void {
  updateReadState(entry, (_prev) => {
    const events = getAllNotificationEvents(entry);
    const self = entry.pubkey;
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 10;
    const allIds = events.filter((ev) => ev.pubkey !== self).map((ev) => ev.id);
    return { rb: tenDaysAgo, ri: allIds, ab: tenDaysAgo, ai: allIds };
  });
}

// Re-export the state type so callers only need one import
export type { NotificationReadState };
