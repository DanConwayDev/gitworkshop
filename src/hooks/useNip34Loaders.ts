import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import type { RelayGroup } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";
import { includeMailboxes } from "applesauce-core";
import { of, merge } from "rxjs";
import { map } from "rxjs/operators";
import {
  liveness,
  nip34ItemLoader,
  pool,
  type Nip34ItemTier,
} from "@/services/nostr";
import { gitIndexRelays, relayCurationMode } from "@/services/settings";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import type { Filter } from "applesauce-core/helpers";

/** Max healthy inbox relays to take for the item author. */
const MAX_INBOX_RELAYS = 3;

/**
 * Minimum number of the author's inbox relays that must already be present in
 * the group before we consider coverage sufficient and skip adding more.
 */
const INBOX_COVERAGE_THRESHOLD = 2;

export interface Nip34ItemLoaderOptions {
  /**
   * Loading tier — controls which relay subscriptions are opened.
   *
   *   essentials  status (1630-1633), labels (1985), deletions (5)
   *   comments    essentials + NIP-22 comments (1111)
   *   thread      comments + reactions (7) + zaps (9735)
   *
   * Tiers are additive within a subscription lifetime: upgrading from
   * "essentials" to "thread" opens only the new tiers without re-firing
   * lower ones. On navigation away from the repo all subscriptions close;
   * the next visit starts fresh.
   *
   * Default: "essentials"
   */
  tier?: Nip34ItemTier;
  /**
   * When true, also fetches from the NIP-65 inbox relays of the item author
   * when those relays are not already sufficiently covered by the group.
   * Enable on detail pages (IssuePage / PRPage) for completeness.
   * Default: false.
   */
  includeAuthorNip65?: boolean;
}

/**
 * Reactively resolve the NIP-65 inbox relays for a single pubkey that are
 * NOT already sufficiently covered by the repo relay group.
 *
 * Returns [] when coverage is already met or when disabled.
 */
function useAuthorInboxDeltaRelays(
  pubkey: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  enabled: boolean,
): string[] {
  const store = useEventStore();

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

        const overlapCount = authorInboxRelays.filter((r) =>
          groupRelaySet.has(r),
        ).length;

        if (overlapCount >= INBOX_COVERAGE_THRESHOLD) return [] as string[];

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
 * Triggers tiered loading for a single NIP-34 item (issue, patch, or PR).
 *
 * Loading tiers (see Nip34ItemLoaderOptions.tier):
 *
 *   essentials (default) — status, labels, deletions
 *     Called from list pages. Merges automatically with nip34RepoLoader
 *     calls from useIssues / usePRs because both use the same singleton
 *     loader instances — applesauce batches them into one relay subscription.
 *
 *   comments — essentials + NIP-22 comments
 *     Called when comment counts are needed on list pages.
 *
 *   thread — comments + reactions + zaps
 *     Called from detail pages (IssuePage / PRPage).
 *
 * Tier upgrades: each tier is a separate use$() call keyed on its own dep
 * string. When the user navigates to a higher-tier page, only the new tier's
 * use$() fires — lower tiers remain open. All subscriptions close when the
 * user navigates away from the repo; the next visit starts fresh.
 *
 * NIP-65 author inbox relays: when includeAuthorNip65 is true, a second
 * nip34ItemLoader is fired against the delta inbox relays (those not already
 * covered by the group). This is a separate observable with its own
 * subscription — the shared relay group is never mutated.
 *
 * @param itemId         - The event ID of the issue / patch / PR
 * @param repoRelayGroup - The base relay group from useResolvedRepository
 * @param options        - Tier and NIP-65 options
 */
export function useNip34ItemLoader(
  itemId: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  options?: Nip34ItemLoaderOptions,
): void {
  const store = useEventStore();
  const tier = options?.tier ?? "essentials";

  const repoRelays = repoRelayGroup?.relays.map((r) => r.url) ?? [];
  const repoRelayKey = repoRelays.join(",");

  // ── Repo relay loaders ────────────────────────────────────────────────────
  // One use$() per tier so lower tiers stay open when upgrading to a higher
  // tier on a detail page. Each dep array is stable for its tier — the
  // boolean coercion means the dep only changes when the tier threshold is
  // crossed, not on every render.

  // Tier: essentials (always fires when itemId + relays are known)
  use$(() => {
    if (!itemId || repoRelays.length === 0) return undefined;
    return nip34ItemLoader(itemId, repoRelays, "essentials");
  }, [itemId, repoRelayKey]);

  // Tier: comments (fires when tier is "comments" or "thread")
  use$(() => {
    if (!itemId || repoRelays.length === 0) return undefined;
    if (tier !== "comments" && tier !== "thread") return undefined;
    return nip34ItemLoader(itemId, repoRelays, "comments");
  }, [itemId, repoRelayKey, tier === "comments" || tier === "thread"]);

  // Tier: thread (fires only when tier is "thread")
  use$(() => {
    if (!itemId || repoRelays.length === 0) return undefined;
    if (tier !== "thread") return undefined;
    return nip34ItemLoader(itemId, repoRelays, "thread");
  }, [itemId, repoRelayKey, tier === "thread"]);

  // ── NIP-65 author inbox relay loaders ─────────────────────────────────────
  // Reactively resolve the item author pubkey from the store.
  const authorPubkey = use$(() => {
    if (!itemId || !options?.includeAuthorNip65) return of(undefined);
    return store.event(itemId).pipe(map((ev) => ev?.pubkey));
  }, [itemId, options?.includeAuthorNip65, store]);

  // Delta: author inbox relays not already sufficiently covered by the group.
  const authorInboxDelta = useAuthorInboxDeltaRelays(
    authorPubkey,
    repoRelayGroup,
    options?.includeAuthorNip65 ?? false,
  );

  const inboxDeltaKey = authorInboxDelta.join(",");

  // Tier: essentials on inbox delta relays
  use$(() => {
    if (!itemId || authorInboxDelta.length === 0) return undefined;
    return nip34ItemLoader(itemId, authorInboxDelta, "essentials");
  }, [itemId, inboxDeltaKey]);

  // Tier: comments on inbox delta relays
  use$(() => {
    if (!itemId || authorInboxDelta.length === 0) return undefined;
    if (tier !== "comments" && tier !== "thread") return undefined;
    return nip34ItemLoader(itemId, authorInboxDelta, "comments");
  }, [itemId, inboxDeltaKey, tier === "comments" || tier === "thread"]);

  // Tier: thread on inbox delta relays
  use$(() => {
    if (!itemId || authorInboxDelta.length === 0) return undefined;
    if (tier !== "thread") return undefined;
    return nip34ItemLoader(itemId, authorInboxDelta, "thread");
  }, [itemId, inboxDeltaKey, tier === "thread"]);
}

// ---------------------------------------------------------------------------
// Batch loader — fire nip34ItemLoader for multiple item IDs at once
// ---------------------------------------------------------------------------

/**
 * Triggers tiered loading for multiple NIP-34 item IDs simultaneously.
 *
 * Internally calls nip34ItemLoader for each ID. Because the singleton loader
 * instances batch all calls within their buffer window, this results in a
 * single merged relay subscription rather than N separate ones.
 *
 * @param itemIds        - Array of event IDs to load
 * @param repoRelayGroup - The base relay group from useResolvedRepository
 * @param options        - Tier and NIP-65 options (applied to all IDs)
 */
export function useNip34ItemLoaderBatch(
  itemIds: string[],
  repoRelayGroup: RelayGroup | undefined,
  options?: Nip34ItemLoaderOptions,
): void {
  const store = useEventStore();
  const tier = options?.tier ?? "essentials";

  const repoRelays = repoRelayGroup?.relays.map((r) => r.url) ?? [];
  const repoRelayKey = repoRelays.join(",");
  // Stable key for the ID list — re-subscribes only when IDs actually change
  const idsKey = [...itemIds].sort().join(",");

  use$(() => {
    if (itemIds.length === 0 || repoRelays.length === 0) return undefined;
    return merge(
      ...itemIds.map((id) => nip34ItemLoader(id, repoRelays, "essentials")),
    );
  }, [idsKey, repoRelayKey]);

  use$(() => {
    if (itemIds.length === 0 || repoRelays.length === 0) return undefined;
    if (tier !== "comments" && tier !== "thread") return undefined;
    return merge(
      ...itemIds.map((id) => nip34ItemLoader(id, repoRelays, "comments")),
    );
  }, [idsKey, repoRelayKey, tier === "comments" || tier === "thread"]);

  use$(() => {
    if (itemIds.length === 0 || repoRelays.length === 0) return undefined;
    if (tier !== "thread") return undefined;
    return merge(
      ...itemIds.map((id) => nip34ItemLoader(id, repoRelays, "thread")),
    );
  }, [idsKey, repoRelayKey, tier === "thread"]);

  // NIP-65 author inbox relay loading per item
  // (Only fires when includeAuthorNip65 is true — resolves each item's author
  // from the store and loads their inbox delta relays.)
  const authorPubkeys = use$(() => {
    if (!options?.includeAuthorNip65 || itemIds.length === 0)
      return of([] as string[]);
    // Resolve pubkeys from the store synchronously
    const pubkeys = itemIds
      .map(
        (id) =>
          (store.getByFilters([{ ids: [id] }]) as NostrEvent[])[0]?.pubkey,
      )
      .filter((pk): pk is string => !!pk);
    return of([...new Set(pubkeys)]);
  }, [idsKey, options?.includeAuthorNip65, store]);

  const uniquePubkeys = authorPubkeys ?? [];

  // For each unique author pubkey, compute inbox delta relays and load
  // (We reuse useAuthorInboxDeltaRelays for the first pubkey only as a
  // simplification — full multi-author inbox loading is a future enhancement)
  const firstPubkey = uniquePubkeys[0];
  const authorInboxDelta = useAuthorInboxDeltaRelays(
    firstPubkey,
    repoRelayGroup,
    options?.includeAuthorNip65 ?? false,
  );
  const inboxDeltaKey = authorInboxDelta.join(",");

  use$(() => {
    if (itemIds.length === 0 || authorInboxDelta.length === 0) return undefined;
    return merge(
      ...itemIds.map((id) =>
        nip34ItemLoader(id, authorInboxDelta, "essentials"),
      ),
    );
  }, [idsKey, inboxDeltaKey]);

  use$(() => {
    if (itemIds.length === 0 || authorInboxDelta.length === 0) return undefined;
    if (tier !== "comments" && tier !== "thread") return undefined;
    return merge(
      ...itemIds.map((id) => nip34ItemLoader(id, authorInboxDelta, "comments")),
    );
  }, [idsKey, inboxDeltaKey, tier === "comments" || tier === "thread"]);

  use$(() => {
    if (itemIds.length === 0 || authorInboxDelta.length === 0) return undefined;
    if (tier !== "thread") return undefined;
    return merge(
      ...itemIds.map((id) => nip34ItemLoader(id, authorInboxDelta, "thread")),
    );
  }, [idsKey, inboxDeltaKey, tier === "thread"]);
}

// ---------------------------------------------------------------------------
// Detail-page loader — shared by useResolvedIssue and useResolvedPR
// ---------------------------------------------------------------------------

/**
 * Fetches a single NIP-34 item's root event from relays and triggers tiered
 * loading (essentials + comments + thread).
 *
 * Shared between useResolvedIssue and useResolvedPR. Both hooks need the same
 * three steps:
 *   1. Fetch root event by ID from repoRelayGroup (or fallback gitIndexRelays)
 *   2. In outbox mode, also fetch from extraRelaysForMaintainerMailboxCoverage
 *   3. Trigger useNip34ItemLoader at "thread" tier
 *
 * @param itemId          - The event ID of the root issue / PR / patch
 * @param repoRelayGroup  - Base relay group from useResolvedRepository
 * @param extraRelaysForMaintainerMailboxCoverage - Delta relay group for outbox mode
 * @param maintainers     - Effective maintainer set (used to derive a stable key)
 * @returns maintainerKey - Stable string key for use in downstream use$() dep arrays
 */
export function useNip34ItemDetailLoader(
  itemId: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  extraRelaysForMaintainerMailboxCoverage: RelayGroup | undefined,
  maintainers: Set<string> | undefined,
): string {
  const store = useEventStore();
  const curationMode = use$(relayCurationMode);

  // ── 1. Fetch root event by ID from relays ──────────────────────────────
  use$(() => {
    if (!itemId) return undefined;
    const filters: Filter[] = [{ ids: [itemId] }];
    if (repoRelayGroup) {
      return repoRelayGroup
        .subscription(filters)
        .pipe(onlyEvents(), mapEventsToStore(store));
    }
    return pool
      .subscription(gitIndexRelays.getValue(), filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [itemId, repoRelayGroup, store]);

  // ── 2. In outbox mode, also fetch from extra maintainer mailbox relays ──
  use$(() => {
    if (
      !itemId ||
      curationMode !== "outbox" ||
      !extraRelaysForMaintainerMailboxCoverage
    )
      return undefined;
    const filters: Filter[] = [{ ids: [itemId] }];
    return extraRelaysForMaintainerMailboxCoverage
      .subscription(filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [itemId, curationMode, extraRelaysForMaintainerMailboxCoverage, store]);

  // ── 3. Trigger tiered loading (essentials + comments + thread) ──────────
  useNip34ItemLoader(itemId, repoRelayGroup, {
    tier: "thread",
    includeAuthorNip65: curationMode === "outbox",
  });

  // Return a stable maintainer key for downstream use$() dep arrays
  return maintainers ? [...maintainers].sort().join(",") : "loading";
}
