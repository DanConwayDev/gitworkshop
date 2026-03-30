/**
 * Outbox — persistent publish queue with per-relay status tracking.
 *
 * Each event published through the app is recorded as an OutboxItem in
 * IndexedDB. For every relay the event is sent to, an OutboxRelayLog entry
 * tracks whether the publish succeeded and stores the full attempt history.
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
  /**
   * Semantic group IDs this relay serves for this event.
   * A relay can belong to multiple groups simultaneously.
   *
   * Values are one of:
   *   - 64-char hex pubkey  → author's outbox (if pubkey === event.pubkey)
   *                           or recipient's inbox (if pubkey !== event.pubkey)
   *   - "30617:<pubkey>:<d>" → repo relay coord
   *   - "your outbox"        → user's own NIP-65 write relays (legacy / fallback)
   *   - "notification inboxes" → deferred notification delivery
   */
  groups: string[];
  attempts: OutboxSendAttempt[];
  /**
   * Unix seconds. When set, do not retry before this time.
   * Used for rate-limit and timeout backoff.
   */
  tryAfterTimestamp?: number;
  /**
   * When set, this relay permanently rejected the event and should not be
   * retried. The value is the human-readable reason (e.g. "paid relay",
   * "proof of work required").
   */
  permanentFailure?: string;
}

export interface OutboxItem {
  id: string;
  event: NostrEvent;
  /**
   * True when every distinct relay group has at least one successful relay.
   * A group is "covered" when ≥1 relay in that group succeeded.
   */
  broadlySent: boolean;
  relayLogs: OutboxRelayLog[];
  createdAt: number;
  /**
   * The original relay group definitions used to publish this event.
   * Keys are group IDs (pubkey, repo coord, or well-known string).
   * Values are the relay URLs that were resolved for that group at publish time.
   *
   * Stored so that when relay lists change we can re-resolve and discover
   * new relays that should also receive this event.
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
 * Rate limits and timeouts are expected to resolve on their own.
 */
const TRANSIENT_FAILURE_PATTERNS: RegExp[] = [
  /rate.?limit/i,
  /too many/i,
  /timeout/i,
  /slow.?down/i,
  /try.?again/i,
];

/**
 * Classify a relay rejection message.
 *
 * Returns:
 *   - `{ kind: "permanent", reason }` — do not retry
 *   - `{ kind: "transient", delayMs }` — retry after delay
 *   - `{ kind: "unknown" }` — retry with standard delay
 */
export function classifyFailure(
  msg: string,
):
  | { kind: "permanent"; reason: string }
  | { kind: "transient"; delayMs: number }
  | { kind: "unknown" } {
  for (const { pattern, reason } of PERMANENT_FAILURE_PATTERNS) {
    if (pattern.test(msg)) return { kind: "permanent", reason };
  }
  for (const pattern of TRANSIENT_FAILURE_PATTERNS) {
    if (pattern.test(msg))
      return { kind: "transient", delayMs: RATE_LIMIT_RETRY_DELAY_MS };
  }
  // "duplicate" is a success-equivalent — the relay already has it
  if (/duplicate/i.test(msg)) return { kind: "permanent", reason: "duplicate" };
  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// IndexedDB setup
// ---------------------------------------------------------------------------

const DB_NAME = "ngitstack-outbox";
const DB_VERSION = 3; // bumped: wipe pre-semantic-group-ID data
const STORE_OUTBOX = "outbox";

let db: IDBDatabase | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result;
      // Drop and recreate the store on any upgrade — old items used legacy
      // string group IDs that the resolver cannot re-resolve, so there is no
      // value in migrating them.
      if (database.objectStoreNames.contains(STORE_OUTBOX)) {
        database.deleteObjectStore(STORE_OUTBOX);
      }
      database.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
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

/**
 * Callback type for resolving relay URLs for a given group ID.
 *
 * The outbox store calls this when it needs to re-resolve relay groups for
 * pending items (e.g. after a user's NIP-65 relay list changes). The callback
 * should return the current relay URLs for the given group ID, or an empty
 * array if the group is unknown or has no relays.
 *
 * Group IDs follow the same convention as OutboxRelayLog.groups:
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
   * @param event       - The signed event to publish
   * @param relayGroups - Map of group ID → relay URLs
   *                      e.g. { "<pubkey>": ["wss://..."], "30617:...": ["wss://..."] }
   */
  async publish(
    event: NostrEvent,
    relayGroups: Record<string, string[]>,
  ): Promise<void> {
    // Deduplicate relay URLs across groups — a relay can serve multiple groups
    const relayToGroups = new Map<string, string[]>();
    for (const [group, urls] of Object.entries(relayGroups)) {
      for (const url of urls) {
        const existing = relayToGroups.get(url) ?? [];
        if (!existing.includes(group)) existing.push(group);
        relayToGroups.set(url, existing);
      }
    }

    const relayLogs: OutboxRelayLog[] = Array.from(relayToGroups.entries()).map(
      ([url, groups]) => ({ url, groups, success: false, attempts: [] }),
    );

    const item: OutboxItem = {
      id: event.id,
      event,
      broadlySent: false,
      relayLogs,
      createdAt: Math.floor(Date.now() / 1000),
      relayGroupDefs: relayGroups,
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
   * Also merges the new group definitions into relayGroupDefs so future
   * re-resolution picks them up.
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

    // Build new relay logs for URLs not yet tracked; add groups to existing ones
    const updatedLogs = [...item.relayLogs];
    const newUrls: string[] = [];

    for (const [group, urls] of Object.entries(relayGroups)) {
      for (const url of urls) {
        if (existingUrls.has(url)) {
          // Add the group to the existing log entry if not already present
          const logIdx = updatedLogs.findIndex((l) => l.url === url);
          if (logIdx >= 0 && !updatedLogs[logIdx].groups.includes(group)) {
            updatedLogs[logIdx] = {
              ...updatedLogs[logIdx],
              groups: [...updatedLogs[logIdx].groups, group],
            };
          }
        } else {
          updatedLogs.push({
            url,
            groups: [group],
            success: false,
            attempts: [],
          });
          existingUrls.add(url);
          newUrls.push(url);
        }
      }
    }

    // Merge new group defs into relayGroupDefs
    const updatedGroupDefs: Record<string, string[]> = {
      ...item.relayGroupDefs,
    };
    for (const [group, urls] of Object.entries(relayGroups)) {
      const existing = updatedGroupDefs[group] ?? [];
      const merged = [...new Set([...existing, ...urls])];
      updatedGroupDefs[group] = merged;
    }

    const updatedItem: OutboxItem = {
      ...item,
      relayLogs: updatedLogs,
      relayGroupDefs: updatedGroupDefs,
      // Recompute: a relay that already succeeded may now cover a newly-added
      // group, flipping broadlySent to true without any new publish needed.
      broadlySent: this.computeBroadlySent(updatedLogs),
    };

    await this.upsert(updatedItem);

    // Only send to genuinely new relay URLs
    if (newUrls.length > 0) {
      this.sendToSpecificRelays(updatedItem, newUrls);
    }
  }

  /**
   * Re-resolve relay groups for pending items using the current relay lists.
   *
   * When `changedPubkey` is provided, only items whose relayGroupDefs contain
   * that pubkey as a key are re-resolved — avoiding redundant work when only
   * one user's relay list changed.
   *
   * All unique group IDs across the relevant items are resolved in parallel in
   * a single pass, then the results are distributed to each item's addRelays().
   */
  async reResolveRelayGroups(changedPubkey?: string): Promise<void> {
    if (!this.relayGroupResolver) return;

    const pendingItems = this.items$.getValue().filter((i) => !i.broadlySent);

    // Filter to only items that reference the changed pubkey (if provided)
    const items = changedPubkey
      ? pendingItems.filter((i) =>
          Object.keys(i.relayGroupDefs).includes(changedPubkey),
        )
      : pendingItems;

    if (items.length === 0) return;

    // Collect all unique (groupId, eventPubkey) pairs across all relevant items.
    // eventPubkey is needed to distinguish own-outbox vs other-inbox for pubkey groups.
    const uniquePairs = new Map<string, string>(); // groupId → eventPubkey (first seen)
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
    const now = Math.floor(Date.now() / 1000);
    const pendingUrls = item.relayLogs
      .filter(
        (l) =>
          !l.success &&
          !l.permanentFailure &&
          (!l.tryAfterTimestamp || l.tryAfterTimestamp <= now),
      )
      .map((l) => l.url);

    this.sendToSpecificRelays(item, pendingUrls);
  }

  private sendToSpecificRelays(item: OutboxItem, urls: string[]): void {
    if (!this.pool) {
      console.warn("[outbox] pool not injected yet, skipping relay send");
      return;
    }
    if (urls.length === 0) return;

    this.pool
      .publish(urls, item.event)
      .then((responses) => {
        for (const res of responses) {
          this.recordAttempt(item.id, res.from, res.ok, res.message ?? "");
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        for (const url of urls) {
          this.recordAttempt(item.id, url, false, msg);
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

    let retryScheduled = false;

    const updatedLogs = item.relayLogs.map((log) => {
      if (log.url !== relayUrl) return log;

      // Classify before building the attempt so the recorded success value
      // reflects the true outcome (e.g. "duplicate" → success-equivalent).
      let effectiveSuccess = success;
      let permanentFailure: string | undefined;
      let tryAfterTimestamp: number | undefined;

      if (!success) {
        const classification = classifyFailure(msg);
        if (classification.kind === "permanent") {
          if (classification.reason === "duplicate") {
            // Relay already has the event — counts as delivered
            effectiveSuccess = true;
          } else {
            permanentFailure = classification.reason;
          }
        } else if (classification.kind === "transient") {
          tryAfterTimestamp =
            Math.floor(Date.now() / 1000) +
            Math.ceil(classification.delayMs / 1000);
          if (!retryScheduled) {
            retryScheduled = true;
            setTimeout(() => {
              const latest = this.items$.getValue().find((i) => i.id === id);
              if (latest) this.sendToRelays(latest);
            }, classification.delayMs);
          }
        }
        // "unknown" failures: retry on next page load (no immediate schedule)
      }

      const attempt: OutboxSendAttempt = {
        timestamp: Math.floor(Date.now() / 1000),
        success: effectiveSuccess,
        msg,
      };

      const updated: OutboxRelayLog = {
        ...log,
        attempts: [...log.attempts, attempt],
        success: log.success || effectiveSuccess,
        ...(permanentFailure !== undefined && { permanentFailure }),
        ...(tryAfterTimestamp !== undefined && { tryAfterTimestamp }),
      };

      return updated;
    });

    const updatedItem: OutboxItem = {
      ...item,
      relayLogs: updatedLogs,
      broadlySent: this.computeBroadlySent(updatedLogs),
    };

    await this.upsert(updatedItem);
  }

  /**
   * An item is "broadly sent" when every distinct relay group has at least
   * one relay that succeeded (or is a permanent duplicate).
   */
  private computeBroadlySent(logs: OutboxRelayLog[]): boolean {
    const groups = new Set(logs.flatMap((l) => l.groups));
    for (const group of groups) {
      const groupLogs = logs.filter((l) => l.groups.includes(group));
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

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Global singleton outbox store */
export const outboxStore = new OutboxStore();
