/**
 * Notification hooks — thin React wiring over NotificationStoreEntry.
 *
 * Two hooks:
 *   - useNotifications()           — full state for the notifications page
 *   - useUnreadNotificationCount() — just the badge count for the navbar
 *
 * Both share the same singleton NotificationStoreEntry (one per pubkey) so
 * multiple consumers don't create duplicate relay subscriptions.
 *
 * The heavy lifting (relay subs, NIP-78 fetch/decrypt/merge, localStorage,
 * debounced publish, action implementations) lives in
 * src/services/notificationStore.ts.
 */

import { useEffect, useRef, useState } from "react";
import { useActiveAccount } from "applesauce-react/hooks";
import { map, type Observable } from "rxjs";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import {
  acquireNotificationStore,
  releaseNotificationStore,
  type NotificationStoreEntry,
} from "@/services/notificationStore";
import {
  actionMarkAsRead,
  actionMarkAsUnread,
  actionMarkAsArchived,
  actionMarkAsUnarchived,
  actionMarkAllAsRead,
  actionMarkAllAsArchived,
} from "@/services/notificationActions";
import {
  NotificationModel,
  type NotificationModelOutput,
} from "@/models/NotificationModel";
import type { NotificationItem } from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationActions {
  markAsRead: (rootId: string) => void;
  markAsUnread: (rootId: string) => void;
  markAsArchived: (rootId: string) => void;
  markAsUnarchived: (rootId: string) => void;
  markAllAsRead: () => void;
  markAllAsArchived: () => void;
}

// ---------------------------------------------------------------------------
// Shared acquire/release hook
// ---------------------------------------------------------------------------

/**
 * Acquire the singleton store for the active account and return it.
 *
 * #3: acquires synchronously during render (via useState lazy initializer
 * and a ref-tracked pubkey) so readState$ is available on the very first
 * render — no flash of 0 unread count waiting for an effect to fire.
 *
 * The release is handled in a useEffect cleanup so it runs after the last
 * render that used this pubkey, not before the next render.
 */
function useNotificationStoreEntry(): NotificationStoreEntry | undefined {
  const activeAccount = useActiveAccount();
  const pubkey = activeAccount?.pubkey;

  // Acquire synchronously on first render and whenever pubkey changes.
  // useState with a function initializer runs once on mount; after that we
  // use a ref to detect pubkey changes and re-acquire inline.
  const prevPubkeyRef = useRef<string | undefined>(undefined);
  const [entry, setEntry] = useState<NotificationStoreEntry | undefined>(() => {
    if (!pubkey) return undefined;
    prevPubkeyRef.current = pubkey;
    return acquireNotificationStore(pubkey); // released in useEffect cleanup or on pubkey change
  });

  // When pubkey changes, release the old entry and acquire the new one
  // synchronously so the next render already has the correct entry.
  if (pubkey !== prevPubkeyRef.current) {
    if (prevPubkeyRef.current) {
      releaseNotificationStore(prevPubkeyRef.current);
    }
    prevPubkeyRef.current = pubkey;
    const next = pubkey ? acquireNotificationStore(pubkey) : undefined;
    // setState during render is allowed in React when guarded by a condition
    // that tracks the previous value — this is the canonical "derived state"
    // pattern from the React docs.
    setEntry(next);
  }

  // Release on unmount
  useEffect(() => {
    return () => {
      if (prevPubkeyRef.current) {
        releaseNotificationStore(prevPubkeyRef.current);
        prevPubkeyRef.current = undefined;
      }
    };
  }, []);

  return entry;
}

// ---------------------------------------------------------------------------
// useNotifications
// ---------------------------------------------------------------------------

/**
 * Full notification state for the notifications page.
 *
 * Returns grouped items with read/archived status and action functions.
 */
export function useNotifications(): {
  items: NotificationItem[] | undefined;
  unreadCount: number;
  actions: NotificationActions;
} {
  const store = useEventStore();
  const entry = useNotificationStoreEntry();
  const pubkey = entry?.pubkey;
  const readState$ = entry?.readState$;

  // #9: model cache key is pubkey only; readState$ is passed as a separate
  // argument and is not part of the cache key. The BehaviorSubject reference
  // is stable for the lifetime of the store entry.
  const output = use$(() => {
    if (!pubkey || !readState$) return undefined;
    return store.model(
      NotificationModel,
      pubkey,
      readState$,
    ) as unknown as Observable<NotificationModelOutput>;
  }, [pubkey, readState$, store]);

  const actions: NotificationActions = {
    markAsRead: (rootId) => entry && actionMarkAsRead(entry, rootId),
    markAsUnread: (rootId) => entry && actionMarkAsUnread(entry, rootId),
    markAsArchived: (rootId) => entry && actionMarkAsArchived(entry, rootId),
    markAsUnarchived: (rootId) =>
      entry && actionMarkAsUnarchived(entry, rootId),
    markAllAsRead: () => entry && actionMarkAllAsRead(entry),
    markAllAsArchived: () => entry && actionMarkAllAsArchived(entry),
  };

  return {
    items: output?.items,
    unreadCount: output?.unreadCount ?? 0,
    actions,
  };
}

// ---------------------------------------------------------------------------
// useUnreadNotificationCount
// ---------------------------------------------------------------------------

/**
 * Just the unread notification count for the navbar badge.
 * Lightweight — shares the same singleton store as useNotifications.
 */
export function useUnreadNotificationCount(): number {
  const store = useEventStore();
  const entry = useNotificationStoreEntry();
  const pubkey = entry?.pubkey;
  const readState$ = entry?.readState$;

  const count = use$(() => {
    if (!pubkey || !readState$) return undefined;
    return (
      store.model(
        NotificationModel,
        pubkey,
        readState$,
      ) as unknown as Observable<NotificationModelOutput>
    ).pipe(map((output) => output.unreadCount));
  }, [pubkey, readState$, store]);

  return count ?? 0;
}
