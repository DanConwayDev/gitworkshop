/**
 * Notification hooks — subscribe to notification events and read state.
 *
 * Two hooks:
 *   - useNotifications()           — full state for the notifications page
 *   - useUnreadNotificationCount() — just the badge count for the navbar
 *
 * Both share the same singleton NotificationStore (one per pubkey) so
 * multiple consumers don't create duplicate relay subscriptions.
 */

import { useEffect, useMemo, useRef } from "react";
import { useActiveAccount } from "applesauce-react/hooks";
import { BehaviorSubject, type Observable } from "rxjs";
import { map } from "rxjs/operators";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { pool, eventStore, addressLoader } from "@/services/nostr";
import { extraRelays, lookupRelays } from "@/services/settings";
import {
  buildNotificationFilters,
  getNotificationRootId,
  isEventRead,
  isEventArchived,
  advanceReadCutoff,
  advanceArchivedCutoff,
  parseReadState,
  mergeReadStates,
  DEFAULT_READ_STATE,
  NIP78_KIND,
  NOTIFICATION_STATE_D_TAG,
  type NotificationReadState,
  type NotificationItem,
} from "@/lib/notifications";
import {
  NotificationModel,
  type NotificationModelOutput,
} from "@/models/NotificationModel";
import type { NostrEvent } from "nostr-tools";
import type { Filter } from "applesauce-core/helpers";
import {
  unlockEncryptedContent,
  isEncryptedContentUnlocked,
  getEncryptedContent,
} from "applesauce-core/helpers/encrypted-content";

// ---------------------------------------------------------------------------
// Singleton notification store (one per pubkey)
// ---------------------------------------------------------------------------

/**
 * Per-pubkey singleton that manages:
 *   - The BehaviorSubject<NotificationReadState> (local + NIP-78 merged)
 *   - localStorage persistence
 *   - Debounced NIP-78 publish
 *   - Relay subscriptions for notification events
 */
interface NotificationStoreEntry {
  pubkey: string;
  readState$: BehaviorSubject<NotificationReadState>;
  /** Debounce timer for NIP-78 publish */
  publishTimer: ReturnType<typeof setTimeout> | null;
  /** Subscription teardown */
  cleanup: (() => void) | null;
  /** Reference count — cleaned up when it drops to 0 */
  refCount: number;
}

const storeMap = new Map<string, NotificationStoreEntry>();

function localStorageKey(pubkey: string): string {
  return `notifications_state:${pubkey}`;
}

function loadFromLocalStorage(pubkey: string): NotificationReadState {
  try {
    const raw = localStorage.getItem(localStorageKey(pubkey));
    if (raw) return parseReadState(JSON.parse(raw));
  } catch {
    // ignore
  }
  return { ...DEFAULT_READ_STATE };
}

function saveToLocalStorage(
  pubkey: string,
  state: NotificationReadState,
): void {
  try {
    localStorage.setItem(localStorageKey(pubkey), JSON.stringify(state));
  } catch {
    // ignore
  }
}

/**
 * Get or create the singleton notification store for a pubkey.
 * Increments the reference count.
 */
function acquireStore(pubkey: string): NotificationStoreEntry {
  const existing = storeMap.get(pubkey);
  if (existing) {
    existing.refCount++;
    return existing;
  }

  const localState = loadFromLocalStorage(pubkey);
  const readState$ = new BehaviorSubject<NotificationReadState>(localState);

  // Persist to localStorage on every change
  const localSub = readState$.subscribe((state) => {
    saveToLocalStorage(pubkey, state);
  });

  // Subscribe to notification events from relays
  const filters = buildNotificationFilters(pubkey);
  const relays = [...new Set([...extraRelays.getValue()])];
  const relaySub = pool
    .subscription(relays, filters, {
      reconnect: Infinity,
      resubscribe: Infinity,
    })
    .pipe(onlyEvents(), mapEventsToStore(eventStore))
    .subscribe();

  // Fetch the NIP-78 read state from relays and merge with local
  const nip78Sub = addressLoader({
    kind: NIP78_KIND,
    pubkey,
    identifier: NOTIFICATION_STATE_D_TAG,
  }).subscribe();

  // Watch for the NIP-78 event arriving in the store and decrypt it
  const nip78Filter = {
    kinds: [NIP78_KIND],
    authors: [pubkey],
    "#d": [NOTIFICATION_STATE_D_TAG],
  } as Filter;
  const nip78WatchSub = eventStore.timeline([nip78Filter]).subscribe({
    next: async (events) => {
      const evts = events as NostrEvent[];
      if (evts.length === 0) return;
      const latest = evts[0];

      // Try to decrypt and merge
      try {
        if (!isEncryptedContentUnlocked(latest)) {
          // We need the signer to decrypt — import accounts lazily to
          // avoid circular deps
          const { accounts } = await import("@/services/accounts");
          const active = accounts.active$.getValue();
          if (!active || active.pubkey !== pubkey) return;
          await unlockEncryptedContent(latest, pubkey, active.signer);
        }

        const plaintext = getEncryptedContent(latest);
        if (!plaintext) return;

        const relayState = parseReadState(JSON.parse(plaintext));
        const currentLocal = readState$.getValue();
        const merged = mergeReadStates(currentLocal, relayState);

        // Only update if actually different
        if (JSON.stringify(merged) !== JSON.stringify(currentLocal)) {
          readState$.next(merged);
        }
      } catch {
        // Decryption failed — likely not our event or signer unavailable
      }
    },
  });

  const entry: NotificationStoreEntry = {
    pubkey,
    readState$,
    publishTimer: null,
    cleanup: () => {
      localSub.unsubscribe();
      relaySub.unsubscribe();
      nip78Sub.unsubscribe();
      nip78WatchSub.unsubscribe();
    },
    refCount: 1,
  };

  storeMap.set(pubkey, entry);
  return entry;
}

/**
 * Release a reference to the notification store.
 * Cleans up when refCount drops to 0.
 */
function releaseStore(pubkey: string): void {
  const entry = storeMap.get(pubkey);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    entry.cleanup?.();
    if (entry.publishTimer) clearTimeout(entry.publishTimer);
    storeMap.delete(pubkey);
  }
}

// ---------------------------------------------------------------------------
// Debounced NIP-78 publish
// ---------------------------------------------------------------------------

const PUBLISH_DEBOUNCE_MS = 2000;

async function publishReadState(
  pubkey: string,
  state: NotificationReadState,
): Promise<void> {
  try {
    const { accounts } = await import("@/services/accounts");
    const { factory } = await import("@/services/actions");
    const { publish } = await import("@/services/nostr");
    const { AppDataBlueprint } = await import("applesauce-common/blueprints");

    const active = accounts.active$.getValue();
    if (!active || active.pubkey !== pubkey) return;

    const draft = await factory.create(
      AppDataBlueprint<NotificationReadState>,
      NOTIFICATION_STATE_D_TAG,
      state,
      "nip44" as const,
    );
    const signed = await factory.sign(draft);
    await publish(signed, undefined, {
      "User Index Relays": lookupRelays.getValue(),
    });
  } catch (err) {
    console.warn("[notifications] Failed to publish read state:", err);
  }
}

function schedulePublish(entry: NotificationStoreEntry): void {
  if (entry.publishTimer) clearTimeout(entry.publishTimer);
  entry.publishTimer = setTimeout(() => {
    entry.publishTimer = null;
    publishReadState(entry.pubkey, entry.readState$.getValue());
  }, PUBLISH_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

function updateReadState(
  entry: NotificationStoreEntry,
  updater: (prev: NotificationReadState) => NotificationReadState,
): void {
  const next = updater(entry.readState$.getValue());
  entry.readState$.next(next);
  schedulePublish(entry);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface NotificationActions {
  markAsRead: (rootId: string) => void;
  markAsUnread: (rootId: string) => void;
  markAsArchived: (rootId: string) => void;
  markAsUnarchived: (rootId: string) => void;
  markAllAsRead: () => void;
  markAllAsArchived: () => void;
}

/**
 * Full notification state for the notifications page.
 *
 * Subscribes to notification events from relays, loads the NIP-78 read state,
 * and returns grouped items with read/archived status + action functions.
 */
export function useNotifications(): {
  items: NotificationItem[] | undefined;
  unreadCount: number;
  actions: NotificationActions;
} {
  const activeAccount = useActiveAccount();
  const store = useEventStore();
  const pubkey = activeAccount?.pubkey;

  // Acquire/release the singleton store
  const entryRef = useRef<NotificationStoreEntry | null>(null);

  useEffect(() => {
    if (!pubkey) {
      entryRef.current = null;
      return;
    }
    const entry = acquireStore(pubkey);
    entryRef.current = entry;
    return () => {
      releaseStore(pubkey);
      entryRef.current = null;
    };
  }, [pubkey]);

  // Get the readState$ observable for the current pubkey
  const readState$ = useMemo(() => {
    if (!pubkey) return undefined;
    const entry = storeMap.get(pubkey);
    return entry?.readState$;
  }, [pubkey]);

  // Subscribe to the NotificationModel
  const output = use$(() => {
    if (!pubkey || !readState$) return undefined;
    return store.model(
      NotificationModel,
      pubkey,
      readState$,
    ) as unknown as Observable<NotificationModelOutput>;
  }, [pubkey, readState$, store]);

  // Get all notification events from the store for action helpers
  const allEventsRef = useRef<NostrEvent[]>([]);
  const filters = useMemo(
    () => (pubkey ? buildNotificationFilters(pubkey) : []),
    [pubkey],
  );
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);
  const storeEvents = use$(
    () =>
      pubkey
        ? (store.timeline(filters) as unknown as Observable<NostrEvent[]>)
        : undefined,
    [filterKey, store, pubkey],
  );
  useEffect(() => {
    if (storeEvents) allEventsRef.current = storeEvents;
  }, [storeEvents]);

  // Build action functions
  const actions = useMemo((): NotificationActions => {
    const getEntry = () => (pubkey ? storeMap.get(pubkey) : undefined);
    const getEvents = () => allEventsRef.current;
    const getSelfPubkey = () => pubkey ?? "";

    return {
      markAsRead: (rootId: string) => {
        const entry = getEntry();
        if (!entry) return;
        updateReadState(entry, (prev) => {
          const events = getEvents();
          const readIdSet = new Set(prev.ri);
          const newlyReadIds = events
            .filter(
              (ev) =>
                ev.pubkey !== getSelfPubkey() &&
                getNotificationRootId(ev) === rootId &&
                !isEventRead(ev, prev, readIdSet),
            )
            .map((ev) => ev.id);

          if (newlyReadIds.length === 0) return prev;

          const updated = {
            ...prev,
            ri: [...prev.ri, ...newlyReadIds],
          };
          const cutoff = advanceReadCutoff(events, updated, getSelfPubkey());
          return { ...updated, ...cutoff };
        });
      },

      markAsUnread: (rootId: string) => {
        const entry = getEntry();
        if (!entry) return;
        updateReadState(entry, (prev) => {
          const events = getEvents();
          const self = getSelfPubkey();

          // Find all events for this root
          const rootEvents = events.filter(
            (ev) => ev.pubkey !== self && getNotificationRootId(ev) === rootId,
          );
          const rootEventIds = new Set(rootEvents.map((ev) => ev.id));

          // Remove these IDs from the read list
          let newRi = prev.ri.filter((id) => !rootEventIds.has(id));

          // If any of these events are older than rb, we need to lower rb
          const oldestInRoot = Math.min(
            ...rootEvents.map((ev) => ev.created_at),
          );
          let newRb = prev.rb;

          if (oldestInRoot <= prev.rb) {
            newRb = oldestInRoot - 1;
            // Re-mark other events that were read-by-age as explicitly read
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
      },

      markAsArchived: (rootId: string) => {
        const entry = getEntry();
        if (!entry) return;
        updateReadState(entry, (prev) => {
          const events = getEvents();
          const self = getSelfPubkey();
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

          let updated = {
            ...prev,
            ai: [...prev.ai, ...newlyArchivedIds],
          };
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
      },

      markAsUnarchived: (rootId: string) => {
        const entry = getEntry();
        if (!entry) return;
        updateReadState(entry, (prev) => {
          const events = getEvents();
          const self = getSelfPubkey();

          const rootEvents = events.filter(
            (ev) => ev.pubkey !== self && getNotificationRootId(ev) === rootId,
          );
          const rootEventIds = new Set(rootEvents.map((ev) => ev.id));

          let newAi = prev.ai.filter((id) => !rootEventIds.has(id));

          const oldestInRoot = Math.min(
            ...rootEvents.map((ev) => ev.created_at),
          );
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
      },

      markAllAsRead: () => {
        const entry = getEntry();
        if (!entry) return;
        updateReadState(entry, (prev) => {
          const events = getEvents();
          const self = getSelfPubkey();
          const tenDaysAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 10;

          const newRi = events
            .filter((ev) => ev.pubkey !== self && ev.created_at > tenDaysAgo)
            .map((ev) => ev.id);

          return { ...prev, rb: tenDaysAgo, ri: newRi };
        });
      },

      markAllAsArchived: () => {
        const entry = getEntry();
        if (!entry) return;
        updateReadState(entry, (_prev) => {
          const events = getEvents();
          const self = getSelfPubkey();
          const tenDaysAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 10;

          const allIds = events
            .filter((ev) => ev.pubkey !== self)
            .map((ev) => ev.id);

          // Archive all + mark all as read
          return {
            rb: tenDaysAgo,
            ri: allIds,
            ab: tenDaysAgo,
            ai: allIds,
          };
        });
      },
    };
  }, [pubkey]);

  return {
    items: output?.items,
    unreadCount: output?.unreadCount ?? 0,
    actions,
  };
}

/**
 * Just the unread notification count for the navbar badge.
 * Lightweight — shares the same singleton store as useNotifications.
 */
export function useUnreadNotificationCount(): number {
  const activeAccount = useActiveAccount();
  const store = useEventStore();
  const pubkey = activeAccount?.pubkey;

  // Acquire/release the singleton store
  useEffect(() => {
    if (!pubkey) return;
    acquireStore(pubkey);
    return () => releaseStore(pubkey);
  }, [pubkey]);

  const readState$ = useMemo(() => {
    if (!pubkey) return undefined;
    return storeMap.get(pubkey)?.readState$;
  }, [pubkey]);

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
