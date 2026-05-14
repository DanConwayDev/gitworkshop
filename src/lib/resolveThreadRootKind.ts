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
 *      - For zap receipts the #k tag carries the zapped event kind.
 *      - For other thread events (status changes, PR updates, legacy replies)
 *        the kind is known from the event itself.
 *
 *   2. Check the EventStore.
 *      If tier 1 cannot determine the root kind (e.g. a zap with no #k tag,
 *      or a NIP-22 comment with no K tag and an event-pointer root), look up
 *      the referenced event in the in-memory store.
 *
 *   3. Fetch from relays.
 *      If the event is not in the store, fire a one-shot resilientRequest.
 *      For NIP-22 comments, one hop may be needed: comment → thread root.
 *
 * Returns the root kind number, or null if it cannot be determined (network
 * error, timeout, event not found). Callers should treat null as "unknown"
 * and keep the notification rather than silently dropping it.
 */

import type { NostrEvent } from "nostr-tools";
import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import { onlyEvents } from "applesauce-relay";
import {
  getCommentRootPointer,
  isCommentEventPointer,
  isCommentAddressPointer,
  getNip10References,
} from "applesauce-common/helpers";
import type { Filter } from "applesauce-core/helpers";
import { firstValueFrom, timeout } from "rxjs";
import { resilientRequest } from "@/lib/resilientSubscription";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  PR_UPDATE_KIND,
  COMMENT_KIND,
  LEGACY_REPLY_KIND,
  STATUS_KINDS,
  REPO_KIND,
} from "@/lib/nip34";
import { ZAP_RECEIPT_KIND } from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const STATUS_KIND_SET = new Set<number>(STATUS_KINDS);

/** Fetch a single event by ID from the store, or undefined if absent. */
function getFromStore(store: EventStore, id: string): NostrEvent | undefined {
  return (store.getByFilters([{ ids: [id] }]) as NostrEvent[])[0];
}

/**
 * Fetch a single event by ID from relays.
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
      resilientRequest(pool, relays, [{ ids: [id] } as Filter]).pipe(
        onlyEvents(),
        timeout(timeoutMs),
      ),
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
    // Repo zaps (#a tag present, or k=REPO_KIND) are social notifications,
    // not thread items — callers should not be calling us for these, but
    // guard anyway.
    if (
      event.tags.some(([t]) => t === "a") ||
      event.tags.find(([t]) => t === "k")?.[1] === String(REPO_KIND)
    ) {
      return REPO_KIND;
    }

    const k = event.tags.find(([t]) => t === "k")?.[1];
    const e = event.tags.find(([t]) => t === "e")?.[1];

    if (!e) return null; // profile zap with no #e — not a thread item

    if (k !== undefined) {
      const kNum = Number(k);
      if (Number.isNaN(kNum)) return null;

      // If k is a NIP-22 comment, the zap targets a comment — we need the
      // comment's thread root kind, not COMMENT_KIND itself.
      if (kNum === COMMENT_KIND) {
        // Tiers 2/3: fetch the comment, then recurse once to get root kind.
        let comment = getFromStore(store, e);
        if (!comment) {
          comment = await fetchFromRelays(pool, relays, e);
          if (comment) store.add(comment);
        }
        if (!comment) return null;
        return resolveThreadRootKind(comment, store, pool, relays);
      }

      // Any other explicit k → return it directly (covers NIP-34 roots and
      // non-git kinds like kind:1 which callers use to filter out noise).
      return kNum;
    }

    // k absent — LNURL server didn't copy the tag. Fetch the zapped event
    // and inspect its kind (Tiers 2/3).
    let zapTarget = getFromStore(store, e);
    if (!zapTarget) {
      zapTarget = await fetchFromRelays(pool, relays, e);
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
