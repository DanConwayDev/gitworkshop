/**
 * Notification action implementations.
 *
 * Pure functions that mutate the NotificationReadState via updateReadState().
 * They read current events synchronously from the EventStore — no stale refs,
 * no React dependency — so they are testable without rendering components.
 */

import {
  buildNotificationFilters,
  getNotificationRootId,
  isEventRead,
  isEventArchived,
  advanceReadCutoff,
  advanceArchivedCutoff,
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

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function actionMarkAsRead(
  entry: NotificationStoreEntry,
  rootId: string,
): void {
  updateReadState(entry, (prev) => {
    const events = getNotificationEvents(entry.pubkey);
    const readIdSet = new Set(prev.ri);
    const newlyReadIds = events
      .filter(
        (ev) =>
          ev.pubkey !== entry.pubkey &&
          getNotificationRootId(ev) === rootId &&
          !isEventRead(ev, prev, readIdSet),
      )
      .map((ev) => ev.id);

    if (newlyReadIds.length === 0) return prev;

    const updated = { ...prev, ri: [...prev.ri, ...newlyReadIds] };
    const cutoff = advanceReadCutoff(events, updated, entry.pubkey);
    return { ...updated, ...cutoff };
  });
}

export function actionMarkAsUnread(
  entry: NotificationStoreEntry,
  rootId: string,
): void {
  updateReadState(entry, (prev) => {
    const events = getNotificationEvents(entry.pubkey);
    const self = entry.pubkey;

    const rootEvents = events.filter(
      (ev) => ev.pubkey !== self && getNotificationRootId(ev) === rootId,
    );
    if (rootEvents.length === 0) return prev;

    const rootEventIds = new Set(rootEvents.map((ev) => ev.id));
    let newRi = prev.ri.filter((id) => !rootEventIds.has(id));

    const oldestInRoot = Math.min(...rootEvents.map((ev) => ev.created_at));
    let newRb = prev.rb;

    if (oldestInRoot <= prev.rb) {
      newRb = oldestInRoot - 1;
      const reMarkIds = events
        .filter(
          (ev) =>
            ev.pubkey !== self &&
            ev.created_at >= newRb &&
            ev.created_at < prev.rb &&
            !rootEventIds.has(ev.id) &&
            !newRi.includes(ev.id),
        )
        .map((ev) => ev.id);
      newRi = [...newRi, ...reMarkIds];
    }

    const updated = { ...prev, rb: newRb, ri: newRi };
    const cutoff = advanceReadCutoff(events, updated, self);
    return { ...updated, ...cutoff };
  });
}

export function actionMarkAsArchived(
  entry: NotificationStoreEntry,
  rootId: string,
): void {
  updateReadState(entry, (prev) => {
    const events = getNotificationEvents(entry.pubkey);
    const self = entry.pubkey;
    const archivedIdSet = new Set(prev.ai);

    const newlyArchivedIds = events
      .filter(
        (ev) =>
          ev.pubkey !== self &&
          getNotificationRootId(ev) === rootId &&
          !isEventArchived(ev, prev, archivedIdSet),
      )
      .map((ev) => ev.id);

    if (newlyArchivedIds.length === 0) return prev;

    let updated = { ...prev, ai: [...prev.ai, ...newlyArchivedIds] };
    const archivedCutoff = advanceArchivedCutoff(events, updated, self);
    updated = { ...updated, ...archivedCutoff };

    // Archived items are always read too
    const readIdSet = new Set(updated.ri);
    const newlyReadIds = events
      .filter(
        (ev) =>
          ev.pubkey !== self &&
          getNotificationRootId(ev) === rootId &&
          !isEventRead(ev, updated, readIdSet),
      )
      .map((ev) => ev.id);
    if (newlyReadIds.length > 0) {
      updated = { ...updated, ri: [...updated.ri, ...newlyReadIds] };
      const readCutoff = advanceReadCutoff(events, updated, self);
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
    const events = getNotificationEvents(entry.pubkey);
    const self = entry.pubkey;

    const rootEvents = events.filter(
      (ev) => ev.pubkey !== self && getNotificationRootId(ev) === rootId,
    );
    if (rootEvents.length === 0) return prev;

    const rootEventIds = new Set(rootEvents.map((ev) => ev.id));
    let newAi = prev.ai.filter((id) => !rootEventIds.has(id));

    const oldestInRoot = Math.min(...rootEvents.map((ev) => ev.created_at));
    let newAb = prev.ab;

    if (oldestInRoot <= prev.ab) {
      newAb = oldestInRoot - 1;
      const reMarkIds = events
        .filter(
          (ev) =>
            ev.pubkey !== self &&
            ev.created_at >= newAb &&
            ev.created_at < prev.ab &&
            !rootEventIds.has(ev.id) &&
            !newAi.includes(ev.id),
        )
        .map((ev) => ev.id);
      newAi = [...newAi, ...reMarkIds];
    }

    const updated = { ...prev, ab: newAb, ai: newAi };
    const cutoff = advanceArchivedCutoff(events, updated, self);
    return { ...updated, ...cutoff };
  });
}

export function actionMarkAllAsRead(entry: NotificationStoreEntry): void {
  updateReadState(entry, (prev) => {
    const events = getNotificationEvents(entry.pubkey);
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
    const events = getNotificationEvents(entry.pubkey);
    const self = entry.pubkey;
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 10;
    const allIds = events.filter((ev) => ev.pubkey !== self).map((ev) => ev.id);
    return { rb: tenDaysAgo, ri: allIds, ab: tenDaysAgo, ai: allIds };
  });
}

// Re-export the state type so callers only need one import
export type { NotificationReadState };
