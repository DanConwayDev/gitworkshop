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
  activateFullFetch,
  NOTIFICATION_PAGE_LIMIT,
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

export interface NotificationHistoryState {
  /** True while a history block is being fetched */
  loading: boolean;
  /** True if the last block returned a full page (more history available) */
  hasMore: boolean;
  /**
   * True once every relay has either delivered an event older than the
   * archive cutoff or been exhausted. Used to hide "load more" on the inbox
   * tab — all non-archived events have been fetched.
   */
  reachedArchive: boolean;
  /** Fetch the next page of history */
  loadMore: () => void;
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
 * Activates the full history fetch on mount (idempotent — safe to call on
 * every /notifications visit). Returns grouped items, read/archived actions,
 * and history pagination state for the spinner / "load more" button.
 */
export function useNotifications(): {
  items: NotificationItem[] | undefined;
  unreadCount: number;
  actions: NotificationActions;
  history: NotificationHistoryState;
} {
  const store = useEventStore();
  const entry = useNotificationStoreEntry();
  const pubkey = entry?.pubkey;
  const readState$ = entry?.readState$;
  const repoCoords$ = entry?.repoCoords$;

  // Activate the full history fetch on mount. activateFullFetch is idempotent —
  // it creates the loader and fires the first page only once per store entry.
  useEffect(() => {
    if (!pubkey) return;
    activateFullFetch(pubkey).catch(() => {});
  }, [pubkey]);

  // Subscribe to the loader's loading/hasMore state reactively.
  // historyLoader is null until activateFullFetch resolves, so we read it
  // from the entry after the effect fires. We use use$ with the loader's
  // BehaviorSubjects once they exist.
  const historyLoading =
    use$(() => {
      if (!entry?.historyLoader) return undefined;
      return entry.historyLoader.historyLoading$;
    }, [entry?.historyLoader]) ?? false;

  const historyHasMore =
    use$(() => {
      if (!entry?.historyLoader) return undefined;
      return entry.historyLoader.historyHasMore$;
    }, [entry?.historyLoader]) ?? false;

  const historyReachedArchive =
    use$(() => {
      if (!entry?.historyLoader) return undefined;
      return entry.historyLoader.historyReachedArchive$;
    }, [entry?.historyLoader]) ?? false;

  // model cache key is pubkey only; readState$ and repoCoords$ are passed
  // as separate arguments and are not part of the cache key.
  const output = use$(() => {
    if (!pubkey || !readState$ || !repoCoords$) return undefined;
    return store.model(
      NotificationModel,
      pubkey,
      readState$,
      repoCoords$,
    ) as unknown as Observable<NotificationModelOutput>;
  }, [pubkey, readState$, repoCoords$, store]);

  const actions: NotificationActions = {
    markAsRead: (rootId) => entry && actionMarkAsRead(entry, rootId),
    markAsUnread: (rootId) => entry && actionMarkAsUnread(entry, rootId),
    markAsArchived: (rootId) => entry && actionMarkAsArchived(entry, rootId),
    markAsUnarchived: (rootId) =>
      entry && actionMarkAsUnarchived(entry, rootId),
    markAllAsRead: () => entry && actionMarkAllAsRead(entry),
    markAllAsArchived: () => entry && actionMarkAllAsArchived(entry),
  };

  const history: NotificationHistoryState = {
    loading: historyLoading,
    hasMore: historyHasMore,
    reachedArchive: historyReachedArchive,
    loadMore: () => entry?.historyLoader?.loadMore(NOTIFICATION_PAGE_LIMIT),
  };

  return {
    items: output?.items,
    unreadCount: output?.unreadCount ?? 0,
    actions,
    history,
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
  const repoCoords$ = entry?.repoCoords$;

  const count = use$(() => {
    if (!pubkey || !readState$ || !repoCoords$) return undefined;
    return (
      store.model(
        NotificationModel,
        pubkey,
        readState$,
        repoCoords$,
      ) as unknown as Observable<NotificationModelOutput>
    ).pipe(map((output) => output.unreadCount));
  }, [pubkey, readState$, repoCoords$, store]);

  return count ?? 0;
}
