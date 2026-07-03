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
 * Broadly-sent items are pruned after 48 hours. Items that were never broadly
 * sent are expired after 7 days: a final publish attempt is made (waiting for
 * pool.event() to complete so relays that came back online get one last
 * chance), then the item is removed from IndexedDB.
 *
 * Relay groups are tracked by semantic ID strings. Callers declare *intent*
 * by passing group ID strings (e.g. "outbox:<pubkey>", "30617:<pubkey>:<d>",
 * "inbox:<pubkey>") — the outbox resolves them to relay URLs via the injected
 * relayGroupResolver. A relay URL can belong to multiple groups (e.g. a relay
 * that is both the author's outbox and a repo relay). When a user's NIP-65
 * relay list changes, the store re-resolves relay groups for pending items and
 * sends to any newly-discovered relays.
 *
 * The store exposes a BehaviorSubject<OutboxItem[]> so UI components can
 * reactively display the outbox state without polling.
 */

import { BehaviorSubject, Subscription } from "rxjs";
import { ignoreElements } from "rxjs/operators";
import type { NostrEvent } from "nostr-tools";
import type { RelayPool, PublishResponse } from "applesauce-relay";
import { normalizeUrl } from "@/lib/url";

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an array of relay URLs, deduplicating after normalization.
 */
function normalizeRelayUrls(urls: string[]): string[] {
  return [...new Set(urls.map(normalizeUrl))];
}

/**
 * Compare two relay URLs forgiving of cosmetic differences.
 *
 * Both `normalizeUrl` (this app) and `normalizeURL` (applesauce-core, called
 * inside `RelayPool.relay()`) are run, but they disagree on trailing slashes:
 * applesauce keeps the WHATWG `URL`-canonical trailing slash, this app strips
 * it. For most relays both forms collapse to the same string after our
 * `normalizeUrl` is applied, but pathological inputs (uppercased path, extra
 * slashes, query strings) can still mismatch. This compares URLs by the
 * fields that actually identify the relay: scheme + host + port + pathname
 * (with trailing slashes collapsed).
 *
 * Returns true when the two URLs refer to the same relay endpoint.
 */
function urlsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.protocol.toLowerCase() !== ub.protocol.toLowerCase()) return false;
    if (ua.host.toLowerCase() !== ub.host.toLowerCase()) return false;
    const pa = ua.pathname.replace(/\/+$/, "");
    const pb = ub.pathname.replace(/\/+$/, "");
    return pa === pb;
  } catch {
    // Fall back to lenient string compare
    return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RelayStatus =
  "pending" | "success" | "failed" | "retrying" | "permanent";

/** A single publish attempt recorded for a relay. */
export interface RelayAttempt {
  /** Unix seconds when the response was received. */
  at: number;
  /** Whether the relay accepted the event. */
  ok: boolean;
  /** Raw message returned by the relay. */
  message: string;
}

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
  /**
   * For transient failures, the sub-classification used by the UI to show
   * a precise label.
   */
  transientSubkind?:
    | "publish-timeout"
    | "connection-timeout"
    | "connection-error"
    | "rate-limit";
  /**
   * Full history of publish attempts for this relay, oldest first.
   * Each entry records the timestamp, ok/fail, and raw relay message.
   */
  attempts: RelayAttempt[];
  /**
   * Unix seconds. Set when an EVENT message is sent to this relay and a
   * response is being awaited. Cleared (undefined) once a response arrives
   * or the attempt is otherwise resolved. Persisted to IndexedDB so the
   * "sending for N seconds" UI is correct after a tab reload that finds
   * a still-in-flight publish.
   */
  inFlightSince?: number;
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
   * The group IDs declared at publish time. The outbox resolves these to relay
   * URLs via relayGroupResolver. Stored so re-resolution can be triggered when
   * relay lists change (e.g. a new kind:10002 arrives).
   */
  relayGroupDefs: string[];
  /**
   * When true, this item is excluded from the outbox panel UI and pending
   * counts. Used for internal housekeeping events (e.g. notification state
   * updates) that should still go through the outbox retry pipeline but
   * aren't meaningful to the user.
   */
  hidden?: boolean;
}

/** Options for {@link OutboxStore.publish}. */
export interface OutboxPublishOptions {
  /**
   * When true, the item is hidden from the outbox panel UI and pending
   * counts. The event still goes through the full retry pipeline.
   */
  hidden?: boolean;
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate a relay permanently rejected the event.
 * These should never be retried — the relay has a policy that won't change.
 */
const PERMANENT_FAILURE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bpay\b|paid|subscription|member/i, reason: "paid relay" },
  { pattern: /proof.of.work|pow/i, reason: "proof of work required" },
  { pattern: /white.?list|allowlist/i, reason: "not on whitelist" },
  { pattern: /black.?list|banned|blocked/i, reason: "blocked" },
  { pattern: /restricted/i, reason: "restricted relay" },
  { pattern: /not allowed/i, reason: "not allowed" },
  { pattern: /invite.only/i, reason: "invite only" },
];

/**
 * Patterns that indicate a transient failure that should be retried.
 *
 * Each entry carries a `subkind` that the UI uses to show a precise label
 * without having to re-parse the message string.
 *
 * Sub-kinds:
 *   "publish-timeout"    — event was sent but no OK was received in time
 *                          (applesauce emits the literal string "Timeout")
 *   "connection-timeout" — address unreachable / relay never became ready,
 *                          so the connection attempt itself timed out
 *   "connection-error"   — WebSocket closed / refused before OK was received
 *   "rate-limit"         — relay asked us to slow down
 *
 * Order matters: more-specific patterns must come before broader ones.
 */
const TRANSIENT_FAILURE_PATTERNS: Array<{
  pattern: RegExp;
  subkind:
    | "publish-timeout"
    | "connection-timeout"
    | "connection-error"
    | "rate-limit";
}> = [
  // Browser/OS-level unreachability — address not routable, DNS failure, etc.
  {
    pattern:
      /ERR_ADDRESS_UNREACHABLE|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ECONNREFUSED|ENOTFOUND|ENETUNREACH|EHOSTUNREACH/i,
    subkind: "connection-timeout",
  },
  // WebSocket / network-level connection failures (generic)
  {
    pattern: /websocket|connection|connect|refused|network|socket/i,
    subkind: "connection-error",
  },
  // Exact "Timeout" emitted by applesauce relay.event() when no OK arrives
  // after the event was sent (publish-level timeout, not connection-level)
  { pattern: /^Timeout$/, subkind: "publish-timeout" },
  // Generic timeout wording from relay messages
  { pattern: /timed?\s*out/i, subkind: "publish-timeout" },
  // Rate-limiting / back-pressure
  {
    pattern: /rate.?limit|too many|slow.?down|try.?again/i,
    subkind: "rate-limit",
  },
];

/**
 * Exponential backoff schedule for transient relay failures.
 *
 * Index = number of failed attempts so far (after the response is recorded).
 * After the last entry the relay is left as "failed" — no more automatic
 * retries until the user clicks retry or reloads the page.
 *
 *   1st failure → retry after 65 s
 *   2nd failure → retry after 5 min
 *   3rd failure → retry after 1 hr
 *   4th+ failure → stop, leave as failed
 */
const BACKOFF_SCHEDULE_MS = [65_000, 5 * 60_000, 60 * 60_000];

/**
 * Classify a relay rejection message.
 */
function classifyFailure(msg: string):
  | { kind: "permanent"; reason: string }
  | {
      kind: "transient";
      subkind:
        | "publish-timeout"
        | "connection-timeout"
        | "connection-error"
        | "rate-limit";
    }
  | { kind: "duplicate" }
  | { kind: "unknown" } {
  for (const { pattern, reason } of PERMANENT_FAILURE_PATTERNS) {
    if (pattern.test(msg)) return { kind: "permanent", reason };
  }
  for (const { pattern, subkind } of TRANSIENT_FAILURE_PATTERNS) {
    if (pattern.test(msg)) return { kind: "transient", subkind };
  }
  if (/duplicate/i.test(msg)) return { kind: "duplicate" };
  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// IndexedDB persistence
// ---------------------------------------------------------------------------

const DB_NAME = "gitworkshop-outbox";
// Schema version. Bumping wipes the store. Adding optional fields to
// OutboxItem / OutboxRelayEntry is backwards-compatible at the IndexedDB
// level (no schema migration needed) — only bump when removing/renaming
// fields would corrupt deserialization.
const DB_VERSION = 6;
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

/** Prune broadly-sent items after this long */
const PRUNE_BROADLY_SENT_AFTER_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Expire items that were never broadly sent after this long.
 * A final publish attempt is made before deletion so any relays that have
 * come back online get one last chance to accept the event.
 */
const EXPIRE_UNSENT_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Callback type for resolving relay URLs for a given group ID.
 *
 * Group IDs follow the same convention as OutboxRelayEntry.groups:
 *   - "outbox:<pubkey>" → that pubkey's NIP-65 write (outbox) relays
 *   - "inbox:<pubkey>"  → that pubkey's NIP-65 read (inbox) relays
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
      // Any in-flight markers from a previous tab session are stale — the
      // WebSocket and Observable subscription that owned them are gone.
      // Clear them so retryPendingItems() starts fresh attempts that set
      // accurate inFlightSince timestamps.
      const cleaned = items.map((item) => ({
        ...item,
        relays: item.relays.map((r) =>
          r.inFlightSince !== undefined
            ? { ...r, inFlightSince: undefined }
            : r,
        ),
      }));
      this.items$.next(cleaned.sort((a, b) => b.createdAt - a.createdAt));
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
   * Callers declare intent by passing group ID strings. The outbox resolves
   * them immediately via relayGroupResolver and sends to whatever URLs are
   * known now. Groups that resolve to no URLs (e.g. an inbox whose kind:10002
   * hasn't arrived yet) are still stored — reResolveRelayGroups() will retry
   * them when the relay list arrives.
   *
   * @param event    - The signed event to publish
   * @param groupIds - Semantic group IDs (e.g. "outbox:<pubkey>", "30617:<p>:<d>")
   * @param options  - Optional settings (e.g. hidden from UI)
   */
  async publish(
    event: NostrEvent,
    groupIds: string[],
    options?: OutboxPublishOptions,
  ): Promise<void> {
    // Deduplicate group IDs
    const uniqueGroupIds = [...new Set(groupIds)];

    // Insert a provisional item immediately (no relays yet) so the
    // OutboxStatusBadge appears on the event card without any delay while
    // relay group resolution is still in progress.
    const provisionalItem: OutboxItem = {
      id: event.id,
      event,
      broadlySent: false,
      relays: [],
      createdAt: Math.floor(Date.now() / 1000),
      relayGroupDefs: uniqueGroupIds,
      ...(options?.hidden ? { hidden: true } : {}),
    };
    const currentItems = this.items$.getValue();
    if (!currentItems.some((i) => i.id === event.id)) {
      this.items$.next([provisionalItem, ...currentItems]);
    }

    // Resolve all groups in parallel
    const resolvedGroups = await this.resolveGroups(
      uniqueGroupIds,
      event.pubkey,
    );

    // Build relay entries: deduplicate URLs across groups
    const relayToGroups = new Map<string, string[]>();
    for (const [groupId, urls] of resolvedGroups) {
      for (const url of urls) {
        const existing = relayToGroups.get(url) ?? [];
        if (!existing.includes(groupId)) existing.push(groupId);
        relayToGroups.set(url, existing);
      }
    }

    const relays: OutboxRelayEntry[] = Array.from(relayToGroups.entries()).map(
      ([url, groups]) => ({
        url,
        groups,
        status: "pending" as const,
        message: "",
        attempts: [],
      }),
    );

    const item: OutboxItem = {
      id: event.id,
      event,
      broadlySent: this.computeBroadlySent(relays),
      relays,
      createdAt: Math.floor(Date.now() / 1000),
      relayGroupDefs: uniqueGroupIds,
      ...(options?.hidden ? { hidden: true } : {}),
    };

    await this.upsert(item);
    this.sendToRelays(item);
  }

  /**
   * Re-resolve relay groups for pending items using the current relay lists.
   *
   * When `changedPubkey` is provided, only items whose relay group definitions
   * include a group ID referencing that pubkey are re-resolved. This covers:
   *   - "outbox:<pubkey>"  (own outbox relays)
   *   - "inbox:<pubkey>"   (notification inbox relays)
   *   - "30617:<pubkey>:*" (repo coord where that pubkey is the owner)
   */
  async reResolveRelayGroups(changedPubkey?: string): Promise<void> {
    if (!this.relayGroupResolver) return;

    const pendingItems = this.items$.getValue().filter((i) => !i.broadlySent);

    const items = changedPubkey
      ? pendingItems.filter((i) =>
          i.relayGroupDefs.some(
            (groupId) =>
              groupId === `outbox:${changedPubkey}` ||
              groupId === `inbox:${changedPubkey}` ||
              groupId.startsWith(`30617:${changedPubkey}:`),
          ),
        )
      : pendingItems;

    if (items.length === 0) return;

    // Collect all unique group IDs across affected items
    const uniqueGroupIds = [...new Set(items.flatMap((i) => i.relayGroupDefs))];

    // Resolve all unique groups in parallel (use first item's pubkey as hint)
    const pubkeyHint = items[0].event.pubkey;
    const resolved = await this.resolveGroups(uniqueGroupIds, pubkeyHint);

    if (resolved.size === 0) return;

    // Distribute newly-resolved URLs to each item
    await Promise.all(
      items.map(async (item) => {
        const newRelayToGroups = new Map<string, string[]>();
        for (const groupId of item.relayGroupDefs) {
          const urls = resolved.get(groupId) ?? [];
          for (const url of urls) {
            const existing = newRelayToGroups.get(url) ?? [];
            if (!existing.includes(groupId)) existing.push(groupId);
            newRelayToGroups.set(url, existing);
          }
        }
        if (newRelayToGroups.size > 0) {
          await this.mergeResolvedRelays(item.id, newRelayToGroups);
        }
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Internal: relay resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve a list of group IDs to relay URLs using the injected resolver.
   * Returns a Map of groupId → normalized URL array (empty array if unresolved).
   */
  private async resolveGroups(
    groupIds: string[],
    eventPubkey: string,
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!this.relayGroupResolver) return result;

    await Promise.all(
      groupIds.map(async (groupId) => {
        try {
          const urls = await this.relayGroupResolver!(groupId, eventPubkey);
          result.set(groupId, normalizeRelayUrls(urls));
        } catch {
          result.set(groupId, []);
        }
      }),
    );

    return result;
  }

  /**
   * Merge a resolved relay→groups map into an existing outbox item, sending
   * to any URLs not already tracked.
   */
  private async mergeResolvedRelays(
    id: string,
    relayToGroups: Map<string, string[]>,
  ): Promise<void> {
    const current = this.items$.getValue();
    const item = current.find((i) => i.id === id);
    if (!item) return;

    const existingUrls = new Set(item.relays.map((r) => r.url));
    const updatedRelays = [...item.relays];
    const newUrls: string[] = [];

    for (const [url, groups] of relayToGroups) {
      if (existingUrls.has(url)) {
        // URL already tracked — add any new group memberships
        const idx = updatedRelays.findIndex((r) => r.url === url);
        if (idx >= 0) {
          const merged = [...updatedRelays[idx].groups];
          for (const g of groups) {
            if (!merged.includes(g)) merged.push(g);
          }
          updatedRelays[idx] = { ...updatedRelays[idx], groups: merged };
        }
      } else {
        updatedRelays.push({
          url,
          groups,
          status: "pending",
          message: "",
          attempts: [],
        });
        existingUrls.add(url);
        newUrls.push(url);
      }
    }

    const updatedItem: OutboxItem = {
      ...item,
      relays: updatedRelays,
      broadlySent: this.computeBroadlySent(updatedRelays),
    };

    await this.upsert(updatedItem);

    if (newUrls.length > 0) {
      this.sendToSpecificRelays(updatedItem, newUrls);
    }
  }

  /**
   * Manually retry a specific relay for an outbox item.
   *
   * Clears any pending backoff timer, resets the relay status to "pending",
   * and immediately sends the event to that relay. Works for any non-success,
   * non-permanent relay status (including "failed", "retrying", and "pending").
   * Permanent rejections are intentionally not retryable via this method.
   */
  async retryRelay(itemId: string, relayUrl: string): Promise<void> {
    const current = this.items$.getValue();
    const item = current.find((i) => i.id === itemId);
    if (!item) return;

    const relay = item.relays.find((r) => r.url === relayUrl);
    if (!relay || relay.status === "success") return;

    // Cancel any scheduled retry timer for this relay
    const timerKey = `${itemId}:${relayUrl}`;
    const existing = this.retryTimers.get(timerKey);
    if (existing) {
      clearTimeout(existing);
      this.retryTimers.delete(timerKey);
    }

    // Reset relay status to pending and clear any stale in-flight marker so
    // sendToSpecificRelays starts a fresh elapsed timer.
    const updatedRelays = item.relays.map((r) =>
      r.url === relayUrl
        ? {
            ...r,
            status: "pending" as const,
            message: "",
            retryAfter: undefined,
            inFlightSince: undefined,
          }
        : r,
    );
    const updatedItem: OutboxItem = {
      ...item,
      relays: updatedRelays,
      broadlySent: this.computeBroadlySent(updatedRelays),
    };
    await this.upsert(updatedItem);

    // Send immediately
    this.sendToSpecificRelays(updatedItem, [relayUrl]);
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

    // Mark targeted relays as in-flight so the UI can show "sending for N s".
    // We persist this so a reload while a publish is mid-flight still shows
    // accurate elapsed time (the old timestamp survives in IndexedDB and the
    // UI shows time-since-original-send rather than resetting to 0).
    const now = Math.floor(Date.now() / 1000);
    const targeted = new Set(urls.map((u) => normalizeUrl(u)));
    const flagged = item.relays.map((r) =>
      targeted.has(r.url) ? { ...r, inFlightSince: r.inFlightSince ?? now } : r,
    );
    const flaggedItem: OutboxItem = { ...item, relays: flagged };
    // Fire-and-forget the persist — the subscribe below still needs to start
    // immediately so we don't lose responses that arrive in the same tick.
    void this.upsert(flaggedItem);

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
      complete: () => {
        // pool.event() completes once every targeted relay has reported (or
        // applesauce's per-relay eventTimeout has fired). Any relay still
        // marked in-flight at this point received no message — fall back to a
        // synthetic timeout response so the UI doesn't hang.
        this.finalizeStillInFlight(item.id, urls);
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

    const fromUrl = normalizeUrl(response.from);
    const now = Math.floor(Date.now() / 1000);

    // Find the matching relay entry. Prefer exact URL equality but fall back
    // to a forgiving compare so a cosmetic mismatch (trailing slash, host
    // case) never silently drops a response and leaves the relay stuck on
    // "sending…".
    const matchIdx = (() => {
      const exact = item.relays.findIndex((r) => r.url === fromUrl);
      if (exact >= 0) return exact;
      return item.relays.findIndex((r) => urlsMatch(r.url, fromUrl));
    })();

    if (matchIdx < 0) {
      console.warn(
        "[outbox] received PublishResponse for unknown relay:",
        response.from,
        "(normalized:",
        fromUrl,
        ") — dropping",
      );
      return;
    }

    const updatedRelays = item.relays.map((relay, idx) => {
      if (idx !== matchIdx) return relay;

      const attempt: RelayAttempt = {
        at: now,
        ok: response.ok,
        message: response.message ?? (response.ok ? "OK" : "unknown error"),
      };
      const attempts = [...(relay.attempts ?? []), attempt];

      // Every branch produces a finalized relay state, so always clear the
      // in-flight timestamp.
      const baseUpdate = { ...relay, attempts, inFlightSince: undefined };

      if (response.ok) {
        return {
          ...baseUpdate,
          status: "success" as const,
          message: attempt.message,
        };
      }

      const msg = attempt.message;
      const classification = classifyFailure(msg);

      switch (classification.kind) {
        case "duplicate":
          // Relay already has the event — counts as delivered
          return {
            ...baseUpdate,
            status: "success" as const,
            message: "duplicate",
          };

        case "permanent":
          return {
            ...baseUpdate,
            status: "permanent" as const,
            message: msg,
            permanentReason: classification.reason,
          };

        case "transient": {
          // Use attempt count (after recording this one) to pick backoff delay.
          // attempts[] already includes the current attempt at this point.
          const delayMs = BACKOFF_SCHEDULE_MS[attempts.length - 1];

          if (delayMs === undefined) {
            // Exhausted automatic retries — leave as failed, manual retry only
            return {
              ...baseUpdate,
              status: "failed" as const,
              message: msg,
              transientSubkind: classification.subkind,
            };
          }

          const retryAfter =
            Math.floor(Date.now() / 1000) + Math.ceil(delayMs / 1000);

          this.scheduleRetry(itemId, relay.url, delayMs);

          return {
            ...baseUpdate,
            status: "retrying" as const,
            message: msg,
            retryAfter,
            transientSubkind: classification.subkind,
          };
        }

        default:
          // Unknown failure — will be retried on next page load
          return {
            ...baseUpdate,
            status: "failed" as const,
            message: msg,
          };
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

  /**
   * Safety net: when `pool.event()` completes, any targeted relay still
   * marked in-flight received nothing at all (not even applesauce's synthetic
   * "Timeout" PublishResponse — which would normally come through after
   * `eventTimeout`). Synthesize a transient failure so the UI doesn't hang
   * on "sending…" and the normal retry pipeline kicks in.
   */
  private finalizeStillInFlight(itemId: string, urls: string[]): void {
    const targeted = new Set(urls.map((u) => normalizeUrl(u)));
    const item = this.items$.getValue().find((i) => i.id === itemId);
    if (!item) return;
    for (const relay of item.relays) {
      if (relay.inFlightSince === undefined) continue;
      if (!targeted.has(relay.url)) continue;
      this.handleResponse(itemId, {
        ok: false,
        from: relay.url,
        message: "Timeout",
      });
    }
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
    const now = Date.now();
    const broadlySentCutoff = Math.floor(
      (now - PRUNE_BROADLY_SENT_AFTER_MS) / 1000,
    );
    const expiryCutoff = Math.floor((now - EXPIRE_UNSENT_AFTER_MS) / 1000);
    const items = this.items$.getValue();

    // Broadly-sent items older than 48 h — delete immediately
    const broadlySentToDelete = items.filter(
      (i) => i.broadlySent && i.createdAt < broadlySentCutoff,
    );

    // Non-broadly-sent items older than 7 days — final attempt then delete
    const expiredUnsent = items.filter(
      (i) => !i.broadlySent && i.createdAt < expiryCutoff,
    );

    for (const item of broadlySentToDelete) {
      await idbDelete(item.id);
    }

    // For expired-unsent items: make one final publish attempt and wait for
    // pool.event() to complete (it has its own per-relay timeout), then delete.
    for (const item of expiredUnsent) {
      if (this.pool) {
        const retryUrls = item.relays
          .filter((r) => r.status !== "success" && r.status !== "permanent")
          .map((r) => r.url);

        if (retryUrls.length > 0) {
          await new Promise<void>((resolve) => {
            this.pool!.event(retryUrls, item.event)
              .pipe(ignoreElements())
              .subscribe({ complete: resolve, error: resolve });
          });
        }
      }
      await idbDelete(item.id);
    }

    const deleteIds = new Set([
      ...broadlySentToDelete.map((i) => i.id),
      ...expiredUnsent.map((i) => i.id),
    ]);

    if (deleteIds.size > 0) {
      this.items$.next(items.filter((i) => !deleteIds.has(i.id)));
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Global singleton outbox store */
export const outboxStore = new OutboxStore();
