/**
 * NotificationStore — singleton service (one per pubkey) that manages:
 *   - BehaviorSubject<NotificationReadState> (local + NIP-78 merged)
 *   - localStorage persistence
 *   - Debounced NIP-78 publish
 *   - Relay subscriptions for notification events (inbox relays + extra)
 *   - All action methods (markAsRead, markAsUnread, etc.)
 *
 * Consumers acquire/release a reference via acquireNotificationStore /
 * releaseNotificationStore. The store is torn down when refCount hits 0.
 *
 * This matches the pattern of src/services/outbox.ts — a standalone class
 * whose state is exposed as a BehaviorSubject that React hooks subscribe to.
 */

import { BehaviorSubject, firstValueFrom, of } from "rxjs";
import { timeout } from "rxjs/operators";
import { mapEventsToStore } from "applesauce-core";
import { MailboxesModel } from "applesauce-core/models";
import { onlyEvents } from "applesauce-relay";
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
} from "@/lib/notifications";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import {
  unlockEncryptedContent,
  isEncryptedContentUnlocked,
  getEncryptedContent,
} from "applesauce-core/helpers/encrypted-content";

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// NotificationStoreEntry
// ---------------------------------------------------------------------------

export interface NotificationStoreEntry {
  pubkey: string;
  readState$: BehaviorSubject<NotificationReadState>;
  /** Debounce timer for NIP-78 publish */
  publishTimer: ReturnType<typeof setTimeout> | null;
  /** Subscription teardown */
  cleanup: (() => void) | null;
  /** Reference count — cleaned up when it drops to 0 */
  refCount: number;
}

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

/**
 * Read notification events directly from the EventStore (synchronous, no
 * stale-ref risk). This replaces the allEventsRef pattern.
 */
function getNotificationEvents(pubkey: string): NostrEvent[] {
  const filters = buildNotificationFilters(pubkey);
  return eventStore.getByFilters(filters);
}

function schedulePublish(entry: NotificationStoreEntry): void {
  if (entry.publishTimer) clearTimeout(entry.publishTimer);
  entry.publishTimer = setTimeout(() => {
    entry.publishTimer = null;
    publishReadState(entry.pubkey, entry.readState$.getValue());
  }, PUBLISH_DEBOUNCE_MS);
}

function updateReadState(
  entry: NotificationStoreEntry,
  updater: (prev: NotificationReadState) => NotificationReadState,
): void {
  const next = updater(entry.readState$.getValue());
  entry.readState$.next(next);
  schedulePublish(entry);
}

// ---------------------------------------------------------------------------
// Action implementations
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

    // #6: explicit early return for empty rootEvents
    if (rootEvents.length === 0) return prev;

    const rootEventIds = new Set(rootEvents.map((ev) => ev.id));
    let newRi = prev.ri.filter((id) => !rootEventIds.has(id));

    // #5: build eventById Map for O(1) lookups in advanceReadCutoff
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

    // #6: explicit early return for empty rootEvents
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

// ---------------------------------------------------------------------------
// Singleton store map
// ---------------------------------------------------------------------------

const storeMap = new Map<string, NotificationStoreEntry>();

/**
 * Resolve the relay list for notification subscriptions.
 *
 * Uses the user's NIP-65 inbox relays (where others send events to them)
 * plus the configured extra relays as fallback. Falls back to extra relays
 * alone if the MailboxesModel hasn't loaded yet.
 *
 * #4: previously hardcoded to extraRelays only.
 */
async function resolveNotificationRelays(pubkey: string): Promise<string[]> {
  try {
    const mailboxes = await firstValueFrom(
      eventStore
        .model(MailboxesModel, pubkey)
        .pipe(timeout({ first: 1000, with: () => of(undefined) })),
    );
    const inboxes = mailboxes?.inboxes ?? [];
    return [...new Set([...inboxes, ...extraRelays.getValue()])];
  } catch {
    return [...new Set([...extraRelays.getValue()])];
  }
}

/**
 * Get or create the singleton notification store for a pubkey.
 * Increments the reference count.
 */
export function acquireNotificationStore(
  pubkey: string,
): NotificationStoreEntry {
  const existing = storeMap.get(pubkey);
  if (existing) {
    existing.refCount++;
    return existing;
  }

  const localState = loadFromLocalStorage(pubkey);
  // #9: readState$ is keyed only by pubkey — the BehaviorSubject persists
  // across acquire/release cycles for the same pubkey via storeMap.
  const readState$ = new BehaviorSubject<NotificationReadState>(localState);

  // Persist to localStorage on every change
  const localSub = readState$.subscribe((state) => {
    saveToLocalStorage(pubkey, state);
  });

  // Subscribe to notification events from relays.
  // #4: use inbox relays + extra relays (resolved async).
  const filters = buildNotificationFilters(pubkey);
  let relaySub = { unsubscribe: () => {} };

  resolveNotificationRelays(pubkey).then((relays) => {
    relaySub = pool
      .subscription(relays, filters, {
        reconnect: Infinity,
        resubscribe: Infinity,
      })
      .pipe(onlyEvents(), mapEventsToStore(eventStore))
      .subscribe();
  });

  // Fetch the NIP-78 read state from relays and merge with local.
  // #8: also query user outbox relays for the NIP-78 event so we find
  // state published from another device.
  const nip78Sub = addressLoader({
    kind: NIP78_KIND,
    pubkey,
    identifier: NOTIFICATION_STATE_D_TAG,
  }).subscribe();

  // Also query outbox relays for the NIP-78 event (#8)
  let nip78OutboxSub = { unsubscribe: () => {} };
  firstValueFrom(
    eventStore
      .model(MailboxesModel, pubkey)
      .pipe(timeout({ first: 1000, with: () => of(undefined) })),
  )
    .then((mailboxes) => {
      const outboxes = mailboxes?.outboxes ?? [];
      if (outboxes.length === 0) return;
      const nip78Filter = {
        kinds: [NIP78_KIND],
        authors: [pubkey],
        "#d": [NOTIFICATION_STATE_D_TAG],
      } as Filter;
      nip78OutboxSub = pool
        .subscription(outboxes, [nip78Filter])
        .pipe(onlyEvents(), mapEventsToStore(eventStore))
        .subscribe();
    })
    .catch(() => {});

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

      try {
        if (!isEncryptedContentUnlocked(latest)) {
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

        if (JSON.stringify(merged) !== JSON.stringify(currentLocal)) {
          readState$.next(merged);
        }
      } catch {
        // Decryption failed — signer unavailable or not our event
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
      nip78OutboxSub.unsubscribe();
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
export function releaseNotificationStore(pubkey: string): void {
  const entry = storeMap.get(pubkey);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    entry.cleanup?.();
    if (entry.publishTimer) clearTimeout(entry.publishTimer);
    storeMap.delete(pubkey);
  }
}

/**
 * Get the current store entry for a pubkey without acquiring a reference.
 * Returns undefined if the store hasn't been acquired yet.
 */
export function getNotificationStore(
  pubkey: string,
): NotificationStoreEntry | undefined {
  return storeMap.get(pubkey);
}
