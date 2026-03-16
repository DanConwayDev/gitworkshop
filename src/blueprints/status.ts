/**
 * NIP-34 Status change blueprints (kinds 1630–1633).
 *
 * Per the NIP-34 spec, status events must include:
 *   - `e` tag referencing the issue/PR with a "root" marker
 *   - `a` tag referencing the repository (recommended for relay filter efficiency)
 *   - `p` tags for the repository owner and item author (for notifications)
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
 *   "30617:<owner-pubkey>:<repo-id>",
 *   "<item-author-pubkey>",
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
 * @param statusKind      - The kind number for the desired status (1630–1633)
 * @param itemId          - Hex event ID of the issue or PR being updated
 * @param repoCoord       - Repository coordinate: "30617:<owner-pubkey>:<repo-id>"
 * @param itemAuthorPubkey - Pubkey of the issue/PR author (for notifications)
 */
export function StatusChangeBlueprint(
  statusKind: number,
  itemId: string,
  repoCoord: string,
  itemAuthorPubkey: string,
) {
  // Extract the repo owner pubkey from the coordinate ("30617:<pubkey>:<id>")
  const repoOwnerPubkey = repoCoord.split(":")[1] ?? "";

  return blueprint(
    statusKind,
    modifyPublicTags((tags) => {
      const next = [
        ...tags,
        // Reference the target item with the required "root" marker
        ["e", itemId, "", "root"],
        // Repo coordinate for relay filter efficiency
        ["a", repoCoord],
      ];
      // p-tags for notifications — deduplicate in case author === owner
      const notifyPubkeys = new Set(
        [repoOwnerPubkey, itemAuthorPubkey].filter(Boolean),
      );
      for (const pk of notifyPubkeys) {
        next.push(["p", pk]);
      }
      return next;
    }),
    includeAltTag("Status change"),
  );
}
