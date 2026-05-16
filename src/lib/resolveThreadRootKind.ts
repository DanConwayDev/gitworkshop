/**
 * resolveThreadRootKind
 *
 * Given a notification event, determines the Nostr kind of its thread root.
 * This is used to decide whether a notification belongs to a NIP-34 git
 * thread (issue / PR / patch) or to unrelated Nostr activity.
 *
 * Resolution strategy (three tiers, cheapest first):
 *
 *   1. Inspect the event itself.
 *      - For NIP-34 root kinds (issue/PR/patch) the event IS the root.
 *      - For NIP-22 comments the uppercase K tag carries the root kind, or
 *        the CommentPointer carries it directly (no relay fetch needed).
 *      - For zap receipts the embedded zap request (description tag) carries
 *        the zapped event kind via its #k tag; the receipt's own #k tag is a
 *        fallback for servers that copy it. For addressable-event zaps the #a
 *        coordinate carries the kind directly.
 *      - For other thread events (status changes, PR updates, legacy replies)
 *        the kind is known from the event itself.
 *
 *   2. Check the EventStore.
 *      If tier 1 cannot determine the root kind (e.g. a zap with no #k tag,
 *      or a NIP-22 comment with no K tag and an event-pointer root), look up
 *      the referenced event in the in-memory store.
 *
 *   3. Fetch from relays.
 *      If the event is not in the store, fetch via the module-level batched
 *      fetcher so concurrent calls (e.g. many ambiguous zap receipts arriving
 *      at once) are coalesced into a single { ids: [...] } REQ per relay
 *      rather than one REQ per event.
 *      For NIP-22 comments, one hop may be needed: comment → thread root.
 *
 * Returns the root kind number, or null if it cannot be determined (network
 * error, timeout, event not found). Callers should treat null as "unknown"
 * and keep the notification rather than silently dropping it.
 */

import type { NostrEvent } from "nostr-tools";
import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import {
  getCommentRootPointer,
  isCommentEventPointer,
  isCommentAddressPointer,
  getNip10References,
  getZapRequest,
  getZapEventPointer,
  getZapAddressPointer,
} from "applesauce-common/helpers";
import { firstValueFrom, timeout } from "rxjs";
import {
  createBatchedEventFetcher,
  type BatchedEventFetcher,
} from "@/lib/resilientSubscription";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  PR_UPDATE_KIND,
  COMMENT_KIND,
  LEGACY_REPLY_KIND,
  STATUS_KINDS,
} from "@/lib/nip34";
import { ZAP_RECEIPT_KIND } from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const STATUS_KIND_SET = new Set<number>(STATUS_KINDS);

/**
 * Module-level batched fetcher singleton.
 * Lazily initialised on first use so the pool is available.
 * All calls within a 500 ms window are coalesced into one REQ per relay.
 */
let _batchedFetcher: BatchedEventFetcher | null = null;
let _batchedFetcherPool: RelayPool | null = null;

function getBatchedFetcher(pool: RelayPool): BatchedEventFetcher {
  if (_batchedFetcher === null || _batchedFetcherPool !== pool) {
    _batchedFetcher = createBatchedEventFetcher(pool);
    _batchedFetcherPool = pool;
  }
  return _batchedFetcher;
}

/** Fetch a single event by ID from the store, or undefined if absent. */
function getFromStore(store: EventStore, id: string): NostrEvent | undefined {
  return (store.getByFilters([{ ids: [id] }]) as NostrEvent[])[0];
}

/**
 * Fetch a single event by ID from relays, batching concurrent calls.
 * Returns undefined on timeout, error, or not-found.
 */
async function fetchFromRelays(
  pool: RelayPool,
  relays: string[],
  id: string,
  timeoutMs = 5000,
): Promise<NostrEvent | undefined> {
  if (relays.length === 0) return undefined;
  try {
    return await firstValueFrom(
      getBatchedFetcher(pool)(id, relays).pipe(timeout(timeoutMs)),
    );
  } catch {
    return undefined;
  }
}

/**
 * Resolve the kind of a single event ID: store first, then relay fetch.
 * Adds the fetched event to the store as a side-effect so subsequent calls
 * for the same ID are free.
 */
async function resolveKind(
  id: string,
  store: EventStore,
  pool: RelayPool,
  relays: string[],
): Promise<number | null> {
  let ev = getFromStore(store, id);
  if (!ev) {
    ev = await fetchFromRelays(pool, relays, id);
    if (ev) store.add(ev);
  }
  return ev ? ev.kind : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine the Nostr kind of the thread root for a notification event.
 *
 * @param event  - The notification event to classify
 * @param store  - The in-memory EventStore (checked before hitting relays)
 * @param pool   - The relay pool (used only when the store misses)
 * @param relays - Relay URLs to query (typically the user's inbox relays)
 * @returns      The root event kind, or null if it cannot be determined
 */
export async function resolveThreadRootKind(
  event: NostrEvent,
  store: EventStore,
  pool: RelayPool,
  relays: string[],
): Promise<number | null> {
  // ── Tier 1: event is itself a NIP-34 root ─────────────────────────────────
  if (
    event.kind === ISSUE_KIND ||
    event.kind === PR_KIND ||
    event.kind === PATCH_KIND
  ) {
    return event.kind;
  }

  // ── Tier 1: PR update, status change, legacy reply ────────────────────────
  // These are always git-related by construction (the filter that fetches them
  // already restricts to these kinds). Return the event's own kind so callers
  // can confirm they are git-related without any relay round-trip.
  if (
    event.kind === PR_UPDATE_KIND ||
    event.kind === LEGACY_REPLY_KIND ||
    STATUS_KIND_SET.has(event.kind)
  ) {
    return event.kind;
  }

  // ── Tier 1: NIP-22 comment ────────────────────────────────────────────────
  if (event.kind === COMMENT_KIND) {
    // Fast path A: uppercase K tag carries the root kind directly.
    const kTag = event.tags.find(([t]) => t === "K")?.[1];
    if (kTag !== undefined) {
      const rootKind = Number(kTag);
      if (!Number.isNaN(rootKind)) return rootKind;
    }

    // Fast path B: the CommentPointer itself carries the kind for both event
    // and address pointer variants — no relay fetch needed.
    const rootPointer = getCommentRootPointer(event);
    if (rootPointer !== null) {
      if (
        isCommentEventPointer(rootPointer) ||
        isCommentAddressPointer(rootPointer)
      ) {
        return rootPointer.kind;
      }
      // External pointer (e.g. URL) — not a Nostr event, not a git item.
      return null;
    }

    // Malformed comment with no root pointer — cannot classify.
    return null;
  }

  // ── Tier 1: zap receipt ───────────────────────────────────────────────────
  if (event.kind === ZAP_RECEIPT_KIND) {
    // Addressable-event zaps (#a tag present) — the coordinate encodes the
    // kind directly, so no relay fetch is needed. Repo zaps (REPO_KIND) are
    // social notifications, not thread items; other addressable kinds are
    // returned as-is so callers can decide.
    const addrPointer = getZapAddressPointer(event);
    if (addrPointer !== null) {
      return addrPointer.kind;
    }

    // Read the zapped event kind from the embedded zap request first (the
    // request always carries the #k tag because the client sets it), then
    // fall back to the receipt's own #k tag for servers that copy it.
    const zapRequest = getZapRequest(event);
    const kRaw =
      zapRequest?.tags.find(([t]) => t === "k")?.[1] ??
      event.tags.find(([t]) => t === "k")?.[1];

    const eventPointer = getZapEventPointer(event);
    if (!eventPointer) return null; // profile zap with no #e — not a thread item

    if (kRaw !== undefined) {
      const kNum = Number(kRaw);
      if (Number.isNaN(kNum)) return null;

      // If k is a NIP-22 comment, the zap targets a comment — we need the
      // comment's thread root kind, not COMMENT_KIND itself.
      if (kNum === COMMENT_KIND) {
        // Tiers 2/3: fetch the comment, then recurse once to get root kind.
        let comment = getFromStore(store, eventPointer.id);
        if (!comment) {
          comment = await fetchFromRelays(
            pool,
            eventPointer.relays ?? relays,
            eventPointer.id,
          );
          if (comment) store.add(comment);
        }
        if (!comment) return null;
        return resolveThreadRootKind(comment, store, pool, relays);
      }

      // Any other explicit k → return it directly (covers NIP-34 roots and
      // non-git kinds like kind:1 which callers use to filter out noise).
      return kNum;
    }

    // k absent even in the embedded request — LNURL server didn't set it.
    // Fetch the zapped event and inspect its kind (Tiers 2/3).
    let zapTarget = getFromStore(store, eventPointer.id);
    if (!zapTarget) {
      zapTarget = await fetchFromRelays(
        pool,
        eventPointer.relays ?? relays,
        eventPointer.id,
      );
      if (zapTarget) store.add(zapTarget);
    }
    if (!zapTarget) return null;

    // If the zapped event is itself a NIP-22 comment, recurse once to reach
    // the thread root kind via the comment's K tag / root pointer.
    if (zapTarget.kind === COMMENT_KIND) {
      return resolveThreadRootKind(zapTarget, store, pool, relays);
    }

    return zapTarget.kind;
  }

  // ── NIP-10 fallback ───────────────────────────────────────────────────────
  // For any other event kind that uses NIP-10 root #e tagging (e.g. a
  // future kind we haven't explicitly handled), resolve the root event kind.
  const nip10 = getNip10References(event);
  const rootId = nip10.root?.e?.id;
  if (!rootId) return null;
  return resolveKind(rootId, store, pool, relays);
}

/**
 * Returns true if the resolved root kind is a NIP-34 git item
 * (issue, PR, or patch).
 *
 * Convenience wrapper around resolveThreadRootKind for the common
 * notification-filtering use case.
 *
 * Returns false when the kind cannot be determined (null) — unresolvable
 * events are treated as non-git and excluded from notifications.
 */
export async function isGitThreadNotification(
  event: NostrEvent,
  store: EventStore,
  pool: RelayPool,
  relays: string[],
): Promise<boolean> {
  const kind = await resolveThreadRootKind(event, store, pool, relays);
  if (kind === null) return false; // unresolvable → exclude
  return kind === ISSUE_KIND || kind === PR_KIND || kind === PATCH_KIND;
}
