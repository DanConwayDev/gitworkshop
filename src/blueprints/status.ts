/**
 * NIP-34 Status change blueprints (kinds 1630–1633).
 *
 * Per the NIP-34 spec, status events must include:
 *   - `e` tag referencing the issue/PR with a "root" marker
 *   - `a` tags referencing all repositories (one per coord, for relay filter efficiency)
 *   - `p` tags for each repository owner and the item author (for notifications)
 *
 * Usage:
 * ```ts
 * import { factory } from "@/services/actions";
 * import { publish } from "@/services/nostr";
 * import { StatusChangeBlueprint } from "@/blueprints/status";
 *
 * const template = await factory.create(
 *   StatusChangeBlueprint,
 *   STATUS_CLOSED,
 *   "<issue-or-pr-event-id>",
 *   ["30617:<owner-pubkey>:<repo-id>"],
 *   "<item-author-pubkey>",
 *   "<signer-pubkey>",
 * );
 * const signed = await factory.sign(template);
 * await publish(signed, relays);
 * ```
 */

import { blueprint } from "applesauce-core/event-factory";
import { modifyPublicTags, includeAltTag } from "applesauce-core/operations";
import type { IssueStatus } from "@/lib/nip34";
import {
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_DRAFT,
} from "@/lib/nip34";

/** Map from IssueStatus string to the corresponding kind number. */
export const STATUS_KIND_MAP: Record<
  Exclude<IssueStatus, "deleted">,
  number
> = {
  open: STATUS_OPEN,
  resolved: STATUS_RESOLVED,
  closed: STATUS_CLOSED,
  draft: STATUS_DRAFT,
};

/**
 * Blueprint for publishing a NIP-34 status change event.
 *
 * @param statusKind       - The kind number for the desired status (1630–1633)
 * @param itemId           - Hex event ID of the issue or PR being updated
 * @param repoCoords       - All repository coordinates from the item's `a` tags
 *                           ("30617:<owner-pubkey>:<repo-id>"). One `a` tag is
 *                           emitted per coordinate so relay `#a` filters work for
 *                           every referenced repo.
 * @param itemAuthorPubkey - Pubkey of the issue/PR author (for notifications)
 * @param signerPubkey     - Pubkey of the user publishing the event; excluded
 *                           from `p` notification tags (no need to notify yourself)
 */
export function StatusChangeBlueprint(
  statusKind: number,
  itemId: string,
  repoCoords: string[],
  itemAuthorPubkey: string,
  signerPubkey?: string,
) {
  return blueprint(
    statusKind,
    modifyPublicTags((tags) => {
      const next = [
        ...tags,
        // Reference the target item with the required "root" marker
        ["e", itemId, "", "root"],
        // One a-tag per repo coordinate for relay filter efficiency
        ...repoCoords.map((coord) => ["a", coord]),
      ];
      // p-tags for notifications: item author + all repo owners (one per coord).
      // Deduplicate and exclude the signer (no need to notify yourself).
      const notifyPubkeys = new Set<string>();
      if (itemAuthorPubkey) notifyPubkeys.add(itemAuthorPubkey);
      for (const coord of repoCoords) {
        const ownerPubkey = coord.split(":")[1];
        if (ownerPubkey) notifyPubkeys.add(ownerPubkey);
      }
      if (signerPubkey) notifyPubkeys.delete(signerPubkey);
      for (const pk of notifyPubkeys) {
        next.push(["p", pk]);
      }
      return next;
    }),
    includeAltTag("Status change"),
  );
}
