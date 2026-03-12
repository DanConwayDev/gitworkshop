import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import type { RelayGroup } from "applesauce-relay";
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";
import { includeMailboxes } from "applesauce-core";
import { of } from "rxjs";
import { map } from "rxjs/operators";
import {
  liveness,
  nip34EssentialsLoader,
  nip34CommentsLoader,
  nip34ThreadLoader,
} from "@/services/nostr";

/** Max healthy inbox relays to take for the issue author. */
const MAX_INBOX_RELAYS = 3;

/**
 * Minimum number of the author's inbox relays that must already be present in
 * the group before we consider coverage sufficient and skip adding more.
 * If fewer than this many inbox relays overlap, we add the delta.
 */
const INBOX_COVERAGE_THRESHOLD = 2;

export interface Nip34LoaderOptions {
  /** When true, also fetches from the NIP-65 inbox relays of the item's author.
   *  Only relays not already providing sufficient coverage (< INBOX_COVERAGE_THRESHOLD
   *  overlap with the group) are queried. Loaders fire directly against those
   *  relay URLs — the shared group is never mutated with per-author relays.
   *  Default: false. Enable on detail pages (IssuePage) where completeness
   *  matters; leave off on list pages (RepoPage) to avoid per-item relay churn. */
  includeAuthorNip65?: boolean;
}

/**
 * Reactively resolve the NIP-65 inbox relays for a single pubkey that are
 * NOT already sufficiently covered by the repo relay group.
 *
 * "Sufficient coverage" means at least INBOX_COVERAGE_THRESHOLD of the
 * author's inbox relays are already in the group. If coverage is met, returns
 * an empty array and no extra loaders fire.
 *
 * Re-emits when the kind:10002 event arrives late — the dep on the store's
 * replaceable model means any arriving kind:10002 causes a re-emission.
 */
function useAuthorInboxDeltaRelays(
  pubkey: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  enabled: boolean,
): string[] {
  const store = useEventStore();

  // Snapshot the group's current relay set as a stable key.
  const groupRelaySet = new Set(repoRelayGroup?.relays.map((r) => r.url) ?? []);
  const groupRelayKey = [...groupRelaySet].sort().join(",");

  const inboxDeltaRelays = use$(() => {
    if (!enabled || !pubkey) return of([] as string[]);
    return of([{ pubkey }]).pipe(
      includeMailboxes(store, "inbox"),
      ignoreUnhealthyRelaysOnPointers(liveness),
      map((enriched) => {
        const online = new Set(liveness.online);
        const authorInboxRelays = (enriched[0]?.relays ?? [])
          .slice()
          .sort((a, b) => (online.has(a) ? 0 : 1) - (online.has(b) ? 0 : 1));

        // Count how many of the author's inbox relays are already in the group.
        const overlapCount = authorInboxRelays.filter((r) =>
          groupRelaySet.has(r),
        ).length;

        // If coverage is sufficient, no extra relays needed.
        if (overlapCount >= INBOX_COVERAGE_THRESHOLD) return [] as string[];

        // Otherwise collect the delta: inbox relays not already in the group.
        const seen = new Set<string>(groupRelaySet);
        const delta: string[] = [];
        for (const relay of authorInboxRelays) {
          if (delta.length >= MAX_INBOX_RELAYS) break;
          if (!seen.has(relay)) {
            seen.add(relay);
            delta.push(relay);
          }
        }
        return delta;
      }),
    );
  }, [pubkey, groupRelayKey, enabled, store]);

  return inboxDeltaRelays ?? [];
}

/**
 * Triggers two-tier loading for a NIP-34 item (issue, patch, or PR).
 *
 * Call this once per item rendered in a list or on a detail page. All calls
 * within the same render cycle are batched by the loaders into as few relay
 * subscriptions as possible — one per loader instance, not one per item.
 *
 * Tier 1 — essentials (~100ms buffer, fires first):
 *   { kinds: [1630,1631,1632,1633,1985,5], "#e": [all ids] }
 *   Covers status, NIP-32 labels, and deletion requests.
 *
 * Tier 2 — thread (~500ms buffer, fires after essentials):
 *   - { kinds: [1111], "#E": [all ids] }  — NIP-22 comments (uppercase E)
 *   - { kinds: [7, 9735], "#e": [all ids] } — reactions and zaps
 *
 * Events are written directly into the global EventStore by the loaders.
 * Read them back reactively with store.timeline() / use$.
 *
 * NIP-65 author inbox mode (options.includeAuthorNip65 = true):
 *   Also fetches from the NIP-65 inbox relays of the item author when those
 *   relays are not already sufficiently covered by the group
 *   (< INBOX_COVERAGE_THRESHOLD overlap). Loaders fire directly against the
 *   delta relay URLs — the shared group is never mutated with per-author relays,
 *   since those are specific to this item's author and should not affect other
 *   items in the repo.
 *
 * @param itemId         - The event ID of the issue / patch / PR
 * @param repoRelayGroup - The relay group for this repo (repoRelayGroup or
 *                         repoRelayAndMaintainerMailboxGroup from useResolvedRepository)
 * @param options        - Loader options (nip65)
 */
export function useNip34Loaders(
  itemId: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  options?: Nip34LoaderOptions,
): void {
  const store = useEventStore();

  // ── Repo relay loaders ────────────────────────────────────────────────────
  // Keyed on repoRelayKey — stable after initial group build. Does NOT
  // re-fire when author inbox relays are resolved (separate dep key below).
  const repoRelays = repoRelayGroup?.relays.map((r) => r.url) ?? [];
  const repoRelayKey = repoRelays.join(",");

  // Tier 1 — essentials
  use$(() => {
    if (!itemId) return undefined;
    return nip34EssentialsLoader({ value: itemId, relays: repoRelays });
  }, [itemId, repoRelayKey]);

  // Tier 2 — comments
  use$(() => {
    if (!itemId) return undefined;
    return nip34CommentsLoader({ value: itemId, relays: repoRelays });
  }, [itemId, repoRelayKey]);

  // Tier 2 — reactions + zaps
  use$(() => {
    if (!itemId) return undefined;
    return nip34ThreadLoader({ value: itemId, relays: repoRelays });
  }, [itemId, repoRelayKey]);

  // ── NIP-65 author inbox relay loaders ─────────────────────────────────────
  // Reactively resolve the item author pubkey from the store.
  // Available as soon as the item event lands in the store.
  const authorPubkey = use$(() => {
    if (!itemId || !options?.includeAuthorNip65) return of(undefined);
    return store.event(itemId).pipe(map((ev) => ev?.pubkey));
  }, [itemId, options?.includeAuthorNip65, store]);

  // Delta: author inbox relays not already sufficiently covered by the group.
  // Returns [] when includeAuthorNip65 is false, pubkey unknown, or coverage is met.
  // These relays are per-item-author and must NOT be added to the shared group.
  const authorInboxDelta = useAuthorInboxDeltaRelays(
    authorPubkey,
    repoRelayGroup,
    options?.includeAuthorNip65 ?? false,
  );

  // Fire loaders directly against the author's inbox delta relays.
  // Separate dep key from repo relays so repo loaders are never re-triggered.
  // Skipped entirely when the delta is empty (sufficient coverage case).
  const inboxDeltaKey = authorInboxDelta.join(",");

  // Tier 1 — essentials on author inbox delta relays
  use$(() => {
    if (!itemId || authorInboxDelta.length === 0) return undefined;
    return nip34EssentialsLoader({ value: itemId, relays: authorInboxDelta });
  }, [itemId, inboxDeltaKey]);

  // Tier 2 — comments on author inbox delta relays
  use$(() => {
    if (!itemId || authorInboxDelta.length === 0) return undefined;
    return nip34CommentsLoader({ value: itemId, relays: authorInboxDelta });
  }, [itemId, inboxDeltaKey]);

  // Tier 2 — reactions + zaps on author inbox delta relays
  use$(() => {
    if (!itemId || authorInboxDelta.length === 0) return undefined;
    return nip34ThreadLoader({ value: itemId, relays: authorInboxDelta });
  }, [itemId, inboxDeltaKey]);
}
