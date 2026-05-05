/**
 * StatusChangeFactory — NIP-34 status change (kinds 1630–1633).
 *
 * Per the NIP-34 spec, status events must include:
 *   - `e` tag referencing the issue/PR with a "root" marker
 *   - `a` tags referencing all repositories (one per coord, for relay filter efficiency)
 *   - `p` tags for each repository owner and the item author (for notifications)
 *
 * Usage:
 * ```ts
 * import { StatusChangeFactory } from "@/factories/StatusChangeFactory";
 *
 * const signed = await StatusChangeFactory
 *   .create(STATUS_CLOSED, issueId, repoCoords, itemAuthorPubkey, signerPubkey)
 *   .sign(signer);
 * ```
 */

import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import {
  addAddressPointerTag,
  addProfilePointerTag,
} from "applesauce-core/operations/tag/common";
import type { IssueStatus } from "@/lib/nip34";
import {
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_DRAFT,
} from "@/lib/nip34";
import { getPubkeyRelayHint } from "./hints";
import type { KnownEventTemplate } from "applesauce-core/helpers/event";

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
 * A factory for NIP-34 status change events. The concrete kind (1630/1631/
 * 1632/1633) is parameterised on `create(...)`.
 */
export class StatusChangeFactory<
  K extends number = number,
> extends EventFactory<K, KnownEventTemplate<K>> {
  /**
   * Create a status-change factory.
   *
   * @param statusKind       - Kind for the desired status (1630–1633)
   * @param itemId           - Hex event id of the issue or PR being updated
   * @param repoCoords       - All repo coordinates ("30617:<pubkey>:<d>") — one
   *                           `a` tag is emitted per coord so relay `#a` filters
   *                           work for every referenced repo
   * @param itemAuthorPubkey - Pubkey of the issue/PR author (for notification)
   * @param signerPubkey     - Pubkey of the user publishing the event; excluded
   *                           from `p` notification tags (no need to self-notify)
   */
  static create<K extends number>(
    statusKind: K,
    itemId: string,
    repoCoords: string[],
    itemAuthorPubkey: string,
    signerPubkey?: string,
  ): StatusChangeFactory<K> {
    // Collect notification pubkeys: item author + all repo owners, deduped,
    // excluding the signer.
    const notifyPubkeys = new Set<string>();
    if (itemAuthorPubkey) notifyPubkeys.add(itemAuthorPubkey);
    for (const coord of repoCoords) {
      const ownerPubkey = coord.split(":")[1];
      if (ownerPubkey) notifyPubkeys.add(ownerPubkey);
    }
    if (signerPubkey) notifyPubkeys.delete(signerPubkey);

    let factory = new StatusChangeFactory<K>((resolve) =>
      resolve(blankEventTemplate(statusKind)),
    )
      // NIP-34 required "root" marker on the e-tag. The generic
      // `addEventPointerTag` doesn't support markers so we use a raw tag op.
      .modifyPublicTags((tags) => [...tags, ["e", itemId, "", "root"]])
      // One a-tag per repo coordinate for relay filter efficiency.
      .modifyPublicTags(
        ...repoCoords.map((coord) =>
          addAddressPointerTag(coord, getPubkeyRelayHint),
        ),
      )
      .alt("Status change");

    if (notifyPubkeys.size > 0) {
      factory = factory.modifyPublicTags(
        ...[...notifyPubkeys].map((pk) =>
          addProfilePointerTag(pk, getPubkeyRelayHint),
        ),
      );
    }

    return factory;
  }

  /** Append extra tag tuples. */
  extraTags(tags: string[][]): this {
    if (tags.length === 0) return this;
    return this.modifyPublicTags((existing) => [...existing, ...tags]);
  }
}
