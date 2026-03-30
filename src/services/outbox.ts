/**
 * Outbox — persistent publish queue with per-relay status tracking.
 *
 * Each event published through the app is recorded as an OutboxItem in
 * IndexedDB. For every relay the event is sent to, an OutboxRelayLog entry
 * tracks whether the publish succeeded and stores the full attempt history.
 *
 * On page load, any items that were not fully broadcast are retried
 * automatically. Rate-limited or timed-out relays are retried after a delay.
 *
 * The store exposes a BehaviorSubject<OutboxItem[]> so UI components can
 * reactively display the outbox state without polling.
 */

import { BehaviorSubject } from "rxjs";
import type { NostrEvent } from "nostr-tools";
import type { RelayPool } from "applesauce-relay";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutboxSendAttempt {
  /** Unix seconds */
  timestamp: number;
  success: boolean;
  /** Relay response message */
  msg: string;
}

export interface OutboxRelayLog {
  url: string;
  /** True once at least one attempt succeeded */
  success: boolean;
  /** Human-readable label for the relay group (e.g. "your outbox", "repo relays") */
  group: string;
  attempts: OutboxSendAttempt[];
}

export interface OutboxItem {
  id: string;
  event: NostrEvent;
  /**
   * True when every relay group has at least one successful relay.
   * A group is "covered" when ≥1 relay in that group succeeded.
   */
  broadlySent: boolean;
  relayLogs: OutboxRelayLog[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// IndexedDB setup
// ---------------------------------------------------------------------------

const DB_NAME = "ngitstack-outbox";
const DB_VERSION = 1;
const STORE_OUTBOX = "outbox";

let db: IDBDatabase | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_OUTBOX)) {
        database.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => {
      db = (e.target as IDBOpenDBRequest).result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(): Promise<OutboxItem[]> {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_OUTBOX, "readonly");
    const req = tx.objectStore(STORE_OUTBOX).getAll();
    req.onsuccess = () => resolve(req.result as OutboxItem[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(item: OutboxItem): Promise<void> {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_OUTBOX, "readwrite");
    const req = tx.objectStore(STORE_OUTBOX).put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(id: string): Promise<void> {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_OUTBOX, "readwrite");
    const req = tx.objectStore(STORE_OUTBOX).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// OutboxStore
// ---------------------------------------------------------------------------

/** Retry delay for rate-limited or timed-out relays (65 seconds) */
const RATE_LIMIT_RETRY_DELAY_MS = 65_000;

/** Prune items that have been broadly sent for longer than this */
const PRUNE_AFTER_MS = 48 * 60 * 60 * 1000; // 48 hours

class OutboxStore {
  /** Reactive list of all outbox items, sorted newest-first */
  readonly items$ = new BehaviorSubject<OutboxItem[]>([]);

  /** Injected relay pool — set by nostr.ts after pool is created */
  pool: RelayPool | null = null;

  constructor() {
    this.init();
  }

  private async init() {
    try {
      const items = await idbGetAll();
      this.items$.next(items.sort((a, b) => b.createdAt - a.createdAt));
      this.pruneOldItems();
      this.retryPendingItems();
    } catch (err) {
      console.warn("[outbox] Failed to load from IndexedDB:", err);
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Record a new publish attempt and fire-and-forget the relay sends.
   *
   * @param event      - The signed event to publish
   * @param relayGroups - Map of group label → relay URLs
   *                     e.g. { "your outbox": ["wss://..."], "repo relays": ["wss://..."] }
   */
  async publish(
    event: NostrEvent,
    relayGroups: Record<string, string[]>,
  ): Promise<void> {
    // Deduplicate relay URLs across groups, keeping the first group label seen
    const relayToGroup = new Map<string, string>();
    for (const [group, urls] of Object.entries(relayGroups)) {
      for (const url of urls) {
        if (!relayToGroup.has(url)) relayToGroup.set(url, group);
      }
    }

    const relayLogs: OutboxRelayLog[] = Array.from(relayToGroup.entries()).map(
      ([url, group]) => ({ url, group, success: false, attempts: [] }),
    );

    const item: OutboxItem = {
      id: event.id,
      event,
      broadlySent: false,
      relayLogs,
      createdAt: Math.floor(Date.now() / 1000),
    };

    await this.upsert(item);
    this.sendToRelays(item);
  }

  /**
   * Add relay groups to an already-published outbox item and send to any new
   * relays that weren't in the original publish call.
   *
   * This is used for deferred relay resolution — e.g. notification inboxes
   * that require a network round-trip to fetch the recipient's kind:10002.
   * The initial publish goes out immediately to known relays; once the inbox
   * relays are resolved this method adds them and fires the sends.
   *
   * No-ops silently if the item is not found (already dismissed / pruned).
   */
  async addRelays(
    id: string,
    relayGroups: Record<string, string[]>,
  ): Promise<void> {
    const current = this.items$.getValue();
    const item = current.find((i) => i.id === id);
    if (!item) return;

    // Collect relay URLs already tracked for this item
    const existingUrls = new Set(item.relayLogs.map((l) => l.url));

    // Build new relay logs for URLs not yet tracked
    const newLogs: OutboxRelayLog[] = [];
    for (const [group, urls] of Object.entries(relayGroups)) {
      for (const url of urls) {
        if (!existingUrls.has(url)) {
          newLogs.push({ url, group, success: false, attempts: [] });
          existingUrls.add(url);
        }
      }
    }

    if (newLogs.length === 0) return;

    const updatedItem: OutboxItem = {
      ...item,
      relayLogs: [...item.relayLogs, ...newLogs],
    };

    await this.upsert(updatedItem);
    this.sendToRelays(updatedItem);
  }

  /** Remove an item from the outbox (user-initiated dismiss) */
  async dismiss(id: string): Promise<void> {
    await idbDelete(id);
    this.items$.next(this.items$.getValue().filter((i) => i.id !== id));
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async upsert(item: OutboxItem): Promise<void> {
    await idbPut(item);
    const current = this.items$.getValue();
    const idx = current.findIndex((i) => i.id === item.id);
    const next =
      idx >= 0
        ? current.map((i) => (i.id === item.id ? item : i))
        : [item, ...current];
    this.items$.next(next.sort((a, b) => b.createdAt - a.createdAt));
  }

  private sendToRelays(item: OutboxItem): void {
    if (!this.pool) {
      console.warn("[outbox] pool not injected yet, skipping relay send");
      return;
    }

    const pendingLogs = item.relayLogs.filter((l) => !l.success);
    if (pendingLogs.length === 0) return;

    const relayUrls = pendingLogs.map((l) => l.url);

    this.pool
      .publish(relayUrls, item.event)
      .then((responses) => {
        for (const res of responses) {
          this.recordAttempt(item.id, res.from, res.ok, res.message ?? "");
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        for (const log of pendingLogs) {
          this.recordAttempt(item.id, log.url, false, msg);
        }
      });
  }

  private async recordAttempt(
    id: string,
    relayUrl: string,
    success: boolean,
    msg: string,
  ): Promise<void> {
    const current = this.items$.getValue();
    const item = current.find((i) => i.id === id);
    if (!item) return;

    const attempt: OutboxSendAttempt = {
      timestamp: Math.floor(Date.now() / 1000),
      success,
      msg,
    };

    const updatedLogs = item.relayLogs.map((log) => {
      if (log.url !== relayUrl) return log;
      const updated = {
        ...log,
        attempts: [...log.attempts, attempt],
        success: log.success || success,
      };
      return updated;
    });

    const updatedItem: OutboxItem = {
      ...item,
      relayLogs: updatedLogs,
      broadlySent: this.computeBroadlySent(updatedLogs),
    };

    await this.upsert(updatedItem);

    // Schedule retry for rate-limited or timed-out relays
    if (
      !success &&
      (msg.toLowerCase().includes("rate") ||
        msg.toLowerCase().includes("timeout"))
    ) {
      setTimeout(() => {
        const latest = this.items$.getValue().find((i) => i.id === id);
        if (latest) this.sendToRelays(latest);
      }, RATE_LIMIT_RETRY_DELAY_MS);
    }
  }

  /**
   * An item is "broadly sent" when every distinct relay group has at least
   * one relay that succeeded.
   */
  private computeBroadlySent(logs: OutboxRelayLog[]): boolean {
    const groups = new Set(logs.map((l) => l.group));
    for (const group of groups) {
      const groupLogs = logs.filter((l) => l.group === group);
      if (!groupLogs.some((l) => l.success)) return false;
    }
    return true;
  }

  private async retryPendingItems(): Promise<void> {
    const items = this.items$.getValue();
    for (const item of items) {
      if (!item.broadlySent) {
        this.sendToRelays(item);
      }
    }
  }

  private async pruneOldItems(): Promise<void> {
    const cutoff = Math.floor((Date.now() - PRUNE_AFTER_MS) / 1000);
    const items = this.items$.getValue();
    const toDelete = items.filter((i) => i.broadlySent && i.createdAt < cutoff);
    for (const item of toDelete) {
      await idbDelete(item.id);
    }
    if (toDelete.length > 0) {
      const deleteIds = new Set(toDelete.map((i) => i.id));
      this.items$.next(items.filter((i) => !deleteIds.has(i.id)));
    }
  }
}

/** Global singleton outbox store */
export const outboxStore = new OutboxStore();
