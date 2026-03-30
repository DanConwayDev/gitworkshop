/**
 * Outbox — persistent publish queue with per-relay status tracking.
 *
 * Uses Applesauce's `pool.event()` observable for real-time per-relay publish
 * responses. Each event published through the app is recorded as an OutboxItem
 * in IndexedDB. For every relay the event is sent to, a relay entry tracks
 * whether the publish succeeded and stores the response message.
 *
 * On page load, any items that were not fully broadcast are retried
 * automatically. Rate-limited or timed-out relays are retried after a delay.
 * Permanent failures (paid relay, PoW required, whitelist/blacklist) are
 * never retried.
 *
 * Relay groups are tracked by semantic ID (pubkey hex for author outbox/inbox,
 * repo coord for repo relays). A relay URL can belong to multiple groups (e.g.
 * a relay that is both the author's outbox and a repo relay). When a user's
 * NIP-65 relay list changes, the store re-resolves relay groups for pending
 * items and sends to any newly-discovered relays.
 *
 * The store exposes a BehaviorSubject<OutboxItem[]> so UI components can
 * reactively display the outbox state without polling.
 */

import { BehaviorSubject, Subscription } from "rxjs";
import type { NostrEvent } from "nostr-tools";
import type { RelayPool, PublishResponse } from "applesauce-relay";
import { normalizeURL } from "applesauce-core/helpers";

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a relay URL and strip trailing slashes for deduplication.
 *
 * Wraps Applesauce's `normalizeURL` (which lowercases the scheme/host and
 * removes default ports) then additionally strips trailing slashes.
 * Applesauce intentionally preserves trailing slashes, but different sources
 * (repo announcements, NIP-65 mailboxes, user input) are inconsistent about
 * them, so `wss://relay.damus.io` and `wss://relay.damus.io/` must be
 * treated as the same relay for deduplication.
 */
function normalizeAndStripTrailingSlash(url: string): string {
  return normalizeURL(url).replace(/\/+$/, "");
}

/**
 * Normalize all relay URLs in a relay group map.
 */
function normalizeRelayGroups(
  groups: Record<string, string[]>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [group, urls] of Object.entries(groups)) {
    result[group] = [...new Set(urls.map(normalizeAndStripTrailingSlash))];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RelayStatus =
  | "pending"
  | "success"
  | "failed"
  | "retrying"
  | "permanent";

export interface OutboxRelayEntry {
  url: string;
  status: RelayStatus;
  /** Semantic group IDs this relay serves for this event. */
  groups: string[];
  /** Last response message from the relay (OK or error). */
  message: string;
  /**
   * Unix seconds. When set, do not retry before this time.
   * Used for rate-limit and timeout backoff.
   */
  retryAfter?: number;
  /**
   * When set, this relay permanently rejected the event and should not be
   * retried. The value is the human-readable reason.
   */
  permanentReason?: string;
}

export interface OutboxItem {
  id: string;
  event: NostrEvent;
  /**
   * True when every distinct relay group has at least one successful relay.
   * A group is "covered" when ≥1 relay in that group succeeded.
   */
  broadlySent: boolean;
  relays: OutboxRelayEntry[];
  createdAt: number;
  /**
   * The original relay group definitions used to publish this event.
   * Keys are group IDs (pubkey, repo coord, or well-known string).
   * Values are the relay URLs that were resolved for that group at publish time.
   */
  relayGroupDefs: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate a relay permanently rejected the event.
 * These should never be retried — the relay has a policy that won't change.
 */
const PERMANENT_FAILURE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /paid|subscription|member/i, reason: "paid relay" },
  { pattern: /proof.of.work|pow/i, reason: "proof of work required" },
  { pattern: /white.?list|allowlist/i, reason: "not on whitelist" },
  { pattern: /black.?list|banned|blocked/i, reason: "blocked" },
  { pattern: /restricted/i, reason: "restricted relay" },
  { pattern: /not allowed/i, reason: "not allowed" },
  { pattern: /invite.only/i, reason: "invite only" },
];

/**
 * Patterns that indicate a transient failure that should be retried.
 */
const TRANSIENT_FAILURE_PATTERNS: RegExp[] = [
  /rate.?limit/i,
  /too many/i,
  /timeout/i,
  /slow.?down/i,
  /try.?again/i,
];

/** Retry delay for rate-limited or timed-out relays (65 seconds) */
const RETRY_DELAY_MS = 65_000;

/**
 * Classify a relay rejection message.
 */
function classifyFailure(
  msg: string,
):
  | { kind: "permanent"; reason: string }
  | { kind: "transient"; delayMs: number }
  | { kind: "duplicate" }
  | { kind: "unknown" } {
  for (const { pattern, reason } of PERMANENT_FAILURE_PATTERNS) {
    if (pattern.test(msg)) return { kind: "permanent", reason };
  }
  for (const pattern of TRANSIENT_FAILURE_PATTERNS) {
    if (pattern.test(msg))
      return { kind: "transient", delayMs: RETRY_DELAY_MS };
  }
  if (/duplicate/i.test(msg)) return { kind: "duplicate" };
  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// IndexedDB persistence
// ---------------------------------------------------------------------------

const DB_NAME = "ngitstack-outbox";
const DB_VERSION = 4; // bumped: new schema
const STORE_NAME = "outbox";

let db: IDBDatabase | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result;
      if (database.objectStoreNames.contains(STORE_NAME)) {
        database.deleteObjectStore(STORE_NAME);
      }
      database.createObjectStore(STORE_NAME, { keyPath: "id" });
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
    const tx = database.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as OutboxItem[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(item: OutboxItem): Promise<void> {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(id: string): Promise<void> {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// OutboxStore
// ---------------------------------------------------------------------------

/** Prune items that have been broadly sent for longer than this */
const PRUNE_AFTER_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Callback type for resolving relay URLs for a given group ID.
 *
 * Group IDs follow the same convention as OutboxRelayEntry.groups:
 *   - 64-char hex pubkey → resolve to that pubkey's outbox or inbox relays
 *   - "30617:<pubkey>:<d>" → resolve to that repo's relays
 *   - Other strings → return [] (no dynamic resolution)
 */
export type RelayGroupResolver = (
  groupId: string,
  eventPubkey: string,
) => Promise<string[]>;

class OutboxStore {
  /** Reactive list of all outbox items, sorted newest-first */
  readonly items$ = new BehaviorSubject<OutboxItem[]>([]);

  /** Injected relay pool — set by nostr.ts after pool is created */
  pool: RelayPool | null = null;

  /**
   * Optional resolver for dynamic relay group re-resolution.
   * Set by the caller after construction (e.g. in nostr.ts).
   */
  relayGroupResolver: RelayGroupResolver | null = null;

  /** Active publish subscriptions keyed by `${eventId}:${relayUrl}` */
  private activePublishes = new Map<string, Subscription>();

  /** Pending retry timers keyed by `${eventId}:${relayUrl}` */
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
   * Record a new publish attempt and send to relays via pool.event().
   *
   * @param event       - The signed event to publish
   * @param relayGroups - Map of group ID → relay URLs
   */
  async publish(
    event: NostrEvent,
    relayGroups: Record<string, string[]>,
  ): Promise<void> {
    const normalized = normalizeRelayGroups(relayGroups);

    // Deduplicate relay URLs across groups — a relay can serve multiple groups
    const relayToGroups = new Map<string, string[]>();
    for (const [group, urls] of Object.entries(normalized)) {
      for (const url of urls) {
        const existing = relayToGroups.get(url) ?? [];
        if (!existing.includes(group)) existing.push(group);
        relayToGroups.set(url, existing);
      }
    }

    const relays: OutboxRelayEntry[] = Array.from(relayToGroups.entries()).map(
      ([url, groups]) => ({
        url,
        groups,
        status: "pending" as const,
        message: "",
      }),
    );

    const item: OutboxItem = {
      id: event.id,
      event,
      broadlySent: false,
      relays,
      createdAt: Math.floor(Date.now() / 1000),
      relayGroupDefs: normalized,
    };

    await this.upsert(item);
    this.sendToRelays(item);
  }

  /**
   * Add relay groups to an already-published outbox item and send to any new
   * relays that weren't in the original publish call.
   */
  async addRelays(
    id: string,
    relayGroups: Record<string, string[]>,
  ): Promise<void> {
    const normalized = normalizeRelayGroups(relayGroups);

    const current = this.items$.getValue();
    const item = current.find((i) => i.id === id);
    if (!item) return;

    const existingUrls = new Set(item.relays.map((r) => r.url));
    const updatedRelays = [...item.relays];
    const newUrls: string[] = [];

    for (const [group, urls] of Object.entries(normalized)) {
      for (const url of urls) {
        if (existingUrls.has(url)) {
          const idx = updatedRelays.findIndex((r) => r.url === url);
          if (idx >= 0 && !updatedRelays[idx].groups.includes(group)) {
            updatedRelays[idx] = {
              ...updatedRelays[idx],
              groups: [...updatedRelays[idx].groups, group],
            };
          }
        } else {
          updatedRelays.push({
            url,
            groups: [group],
            status: "pending",
            message: "",
          });
          existingUrls.add(url);
          newUrls.push(url);
        }
      }
    }

    // Merge new group defs
    const updatedGroupDefs: Record<string, string[]> = {
      ...item.relayGroupDefs,
    };
    for (const [group, urls] of Object.entries(normalized)) {
      const existing = updatedGroupDefs[group] ?? [];
      updatedGroupDefs[group] = [...new Set([...existing, ...urls])];
    }

    const updatedItem: OutboxItem = {
      ...item,
      relays: updatedRelays,
      relayGroupDefs: updatedGroupDefs,
      broadlySent: this.computeBroadlySent(updatedRelays),
    };

    await this.upsert(updatedItem);

    if (newUrls.length > 0) {
      this.sendToSpecificRelays(updatedItem, newUrls);
    }
  }

  /**
   * Re-resolve relay groups for pending items using the current relay lists.
   */
  async reResolveRelayGroups(changedPubkey?: string): Promise<void> {
    if (!this.relayGroupResolver) return;

    const pendingItems = this.items$.getValue().filter((i) => !i.broadlySent);

    const items = changedPubkey
      ? pendingItems.filter((i) =>
          Object.keys(i.relayGroupDefs).includes(changedPubkey),
        )
      : pendingItems;

    if (items.length === 0) return;

    // Collect all unique (groupId, eventPubkey) pairs
    const uniquePairs = new Map<string, string>();
    for (const item of items) {
      for (const groupId of Object.keys(item.relayGroupDefs)) {
        if (!uniquePairs.has(groupId)) {
          uniquePairs.set(groupId, item.event.pubkey);
        }
      }
    }

    // Resolve all unique groups in parallel
    const resolved = new Map<string, string[]>();
    await Promise.all(
      Array.from(uniquePairs.entries()).map(async ([groupId, eventPubkey]) => {
        try {
          const urls = await this.relayGroupResolver!(groupId, eventPubkey);
          if (urls.length > 0) resolved.set(groupId, urls);
        } catch {
          // ignore resolution errors
        }
      }),
    );

    if (resolved.size === 0) return;

    // Distribute resolved URLs to each item
    await Promise.all(
      items.map(async (item) => {
        const newGroups: Record<string, string[]> = {};
        for (const groupId of Object.keys(item.relayGroupDefs)) {
          const urls = resolved.get(groupId);
          if (urls) newGroups[groupId] = urls;
        }
        if (Object.keys(newGroups).length > 0) {
          await this.addRelays(item.id, newGroups);
        }
      }),
    );
  }

  /** Remove an item from the outbox (user-initiated dismiss) */
  async dismiss(id: string): Promise<void> {
    // Cancel any active publishes and retry timers for this item
    this.cancelPublishesForItem(id);
    await idbDelete(id);
    this.items$.next(this.items$.getValue().filter((i) => i.id !== id));
  }

  // -------------------------------------------------------------------------
  // Internal: sending via pool.event()
  // -------------------------------------------------------------------------

  /**
   * Send an event to all pending relays using pool.event().
   *
   * Uses the observable-based pool.event() which streams per-relay responses
   * as they arrive, giving real-time status updates in the UI.
   */
  private sendToRelays(item: OutboxItem): void {
    const now = Math.floor(Date.now() / 1000);
    const pendingUrls = item.relays
      .filter(
        (r) =>
          r.status !== "success" &&
          r.status !== "permanent" &&
          (!r.retryAfter || r.retryAfter <= now),
      )
      .map((r) => r.url);

    this.sendToSpecificRelays(item, pendingUrls);
  }

  /**
   * Send an event to specific relay URLs using pool.event().
   *
   * pool.event() returns an Observable<PublishResponse> that emits one
   * response per relay as they arrive, then completes. This gives us
   * real-time per-relay status updates for the UI.
   */
  private sendToSpecificRelays(item: OutboxItem, urls: string[]): void {
    if (!this.pool) {
      console.warn("[outbox] pool not injected yet, skipping relay send");
      return;
    }
    if (urls.length === 0) return;

    const subscription = this.pool.event(urls, item.event).subscribe({
      next: (response: PublishResponse) => {
        this.handleResponse(item.id, response);
      },
      error: (err) => {
        // Connection-level error — mark all targeted relays as failed
        const msg = err instanceof Error ? err.message : String(err);
        for (const url of urls) {
          this.handleResponse(item.id, { ok: false, message: msg, from: url });
        }
      },
    });

    // Track the subscription so we can cancel on dismiss
    const key = `${item.id}:${urls.join(",")}`;
    this.activePublishes.get(key)?.unsubscribe();
    this.activePublishes.set(key, subscription);
  }

  /**
   * Handle a single relay's publish response.
   *
   * Updates the relay entry status and persists to IndexedDB.
   * Schedules retries for transient failures.
   */
  private async handleResponse(
    itemId: string,
    response: PublishResponse,
  ): Promise<void> {
    const current = this.items$.getValue();
    const item = current.find((i) => i.id === itemId);
    if (!item) return;

    const fromUrl = normalizeAndStripTrailingSlash(response.from);
    const updatedRelays = item.relays.map((relay) => {
      if (relay.url !== fromUrl) return relay;

      if (response.ok) {
        return {
          ...relay,
          status: "success" as const,
          message: response.message ?? "OK",
        };
      }

      const msg = response.message ?? "unknown error";
      const classification = classifyFailure(msg);

      switch (classification.kind) {
        case "duplicate":
          // Relay already has the event — counts as delivered
          return { ...relay, status: "success" as const, message: "duplicate" };

        case "permanent":
          return {
            ...relay,
            status: "permanent" as const,
            message: msg,
            permanentReason: classification.reason,
          };

        case "transient": {
          const retryAfter =
            Math.floor(Date.now() / 1000) +
            Math.ceil(classification.delayMs / 1000);

          // Schedule a retry
          this.scheduleRetry(itemId, relay.url, classification.delayMs);

          return {
            ...relay,
            status: "retrying" as const,
            message: msg,
            retryAfter,
          };
        }

        default:
          // Unknown failure — will be retried on next page load
          return { ...relay, status: "failed" as const, message: msg };
      }
    });

    const updatedItem: OutboxItem = {
      ...item,
      relays: updatedRelays,
      broadlySent: this.computeBroadlySent(updatedRelays),
    };

    await this.upsert(updatedItem);
  }

  /**
   * Schedule a retry for a specific relay after a delay.
   */
  private scheduleRetry(
    itemId: string,
    relayUrl: string,
    delayMs: number,
  ): void {
    const timerKey = `${itemId}:${relayUrl}`;

    // Clear any existing timer
    const existing = this.retryTimers.get(timerKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.retryTimers.delete(timerKey);
      const latest = this.items$.getValue().find((i) => i.id === itemId);
      if (latest) {
        this.sendToSpecificRelays(latest, [relayUrl]);
      }
    }, delayMs);

    this.retryTimers.set(timerKey, timer);
  }

  // -------------------------------------------------------------------------
  // Internal: state management
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

  /**
   * An item is "broadly sent" when every distinct relay group has at least
   * one relay that succeeded.
   */
  private computeBroadlySent(relays: OutboxRelayEntry[]): boolean {
    const groups = new Set(relays.flatMap((r) => r.groups));
    for (const group of groups) {
      const groupRelays = relays.filter((r) => r.groups.includes(group));
      if (!groupRelays.some((r) => r.status === "success")) return false;
    }
    return true;
  }

  private cancelPublishesForItem(itemId: string): void {
    for (const [key, sub] of this.activePublishes) {
      if (key.startsWith(`${itemId}:`)) {
        sub.unsubscribe();
        this.activePublishes.delete(key);
      }
    }
    for (const [key, timer] of this.retryTimers) {
      if (key.startsWith(`${itemId}:`)) {
        clearTimeout(timer);
        this.retryTimers.delete(key);
      }
    }
  }

  private retryPendingItems(): void {
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

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Global singleton outbox store */
export const outboxStore = new OutboxStore();
