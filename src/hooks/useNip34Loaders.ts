import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import type { RelayGroup } from "applesauce-relay";
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";
import { includeMailboxes } from "applesauce-core";
import { of } from "rxjs";
import { map } from "rxjs/operators";
import {
  liveness,
  nip34ItemLoader,
  type Nip34ItemTier,
} from "@/services/nostr";

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
// Backward-compat alias — remove once all call sites are updated
// ---------------------------------------------------------------------------

/** @deprecated Use useNip34ItemLoader instead */
export function useNip34Loaders(
  itemId: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  options?: { includeAuthorNip65?: boolean },
): void {
  useNip34ItemLoader(itemId, repoRelayGroup, {
    tier: "thread",
    includeAuthorNip65: options?.includeAuthorNip65,
  });
}
