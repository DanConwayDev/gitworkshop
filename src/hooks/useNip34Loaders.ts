import { use$ } from "./use$";
import type { RelayGroup } from "applesauce-relay";
import {
  nip34EssentialsLoader,
  nip34CommentsLoader,
  nip34ThreadLoader,
} from "@/services/nostr";

/**
 * Triggers two-tier loading for a NIP-34 item (issue, patch, or PR).
 *
 * Call this once per item rendered in a list. All calls within the same
 * render cycle are batched by the loaders into as few relay subscriptions
 * as possible — one per loader instance, not one per item.
 *
 * Tier 1 — essentials (~100ms buffer, fires first):
 *   One subscription: { kinds: [1630,1631,1632,1633,1985,5], "#e": [all ids] }
 *   Covers status, NIP-32 labels, and deletion requests.
 *
 * Tier 2 — thread (~500ms buffer, fires after essentials):
 *   Two subscriptions:
 *   - { kinds: [1111], "#E": [all ids] }  — NIP-22 comments (uppercase E)
 *   - { kinds: [7, 9735], "#e": [all ids] } — reactions and zaps
 *
 * Events are written directly into the global EventStore by the loaders.
 * Read them back reactively with store.timeline() / use$.
 *
 * @param itemId  - The event ID of the issue / patch / PR
 * @param group   - The repo's long-lived RelayGroup (from useResolvedRepository)
 */
export function useNip34Loaders(
  itemId: string | undefined,
  group: RelayGroup | undefined,
): void {
  // Extract relay URLs from the group for the loaders.
  // The loaders accept a relay URL array; the group's relay list grows over
  // time but the loaders are one-shot (complete on EOSE) so they only see
  // the relays present at call time. This is acceptable — the group's
  // subscription (opened by useIssues) handles live updates.
  const relays = group?.relays.map((r) => r.url) ?? [];
  const relayKey = relays.join(",");

  // Tier 1 — one subscription for all essentials kinds
  use$(() => {
    if (!itemId) return undefined;
    return nip34EssentialsLoader({ value: itemId, relays });
  }, [itemId, relayKey]);

  // Tier 2 — comments (uppercase E tag, separate loader)
  use$(() => {
    if (!itemId) return undefined;
    return nip34CommentsLoader({ value: itemId, relays });
  }, [itemId, relayKey]);

  // Tier 2 — reactions + zaps (lowercase e tag, shared loader)
  use$(() => {
    if (!itemId) return undefined;
    return nip34ThreadLoader({ value: itemId, relays });
  }, [itemId, relayKey]);
}
