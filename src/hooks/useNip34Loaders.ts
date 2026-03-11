import { use$ } from "./use$";
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
 * @param relays  - Relay URLs to query (typically the repo's relay list)
 */
export function useNip34Loaders(
  itemId: string | undefined,
  relays: string[],
): void {
  const relayKey = relays.join(",");

  // Tier 1 — one subscription for all essentials kinds
  use$(
    () => {
      if (!itemId) return undefined;
      return nip34EssentialsLoader({ value: itemId, relays });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId, relayKey],
  );

  // Tier 2 — comments (uppercase E tag, separate loader)
  use$(
    () => {
      if (!itemId) return undefined;
      return nip34CommentsLoader({ value: itemId, relays });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId, relayKey],
  );

  // Tier 2 — reactions + zaps (lowercase e tag, shared loader)
  use$(
    () => {
      if (!itemId) return undefined;
      return nip34ThreadLoader({ value: itemId, relays });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId, relayKey],
  );
}
