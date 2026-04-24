/**
 * NIP-09 Deletion Request blueprint (kind 5).
 *
 * Builds a deletion request event that asks relays to remove one or more
 * events published by the same author.
 *
 * Usage:
 * ```ts
 * import { factory } from "@/services/actions";
 * import { DeletionBlueprint } from "@/blueprints/deletion";
 *
 * // Delete a single reaction event
 * const template = await factory.create(
 *   DeletionBlueprint,
 *   [reactionEvent],
 *   "Changed my mind",
 * );
 * const signed = await factory.sign(template);
 * await publish(signed);
 * ```
 */

import { blueprint } from "applesauce-core/event-factory";
import {
  setContent,
  includeAltTag,
  modifyPublicTags,
} from "applesauce-core/operations";
import type { NostrEvent } from "nostr-tools";

/**
 * Blueprint for a NIP-09 deletion request (kind 5).
 *
 * @param events - One or more events to request deletion of (must share the
 *                 same pubkey as the signer — relays enforce this).
 * @param reason - Optional human-readable reason for the deletion request.
 *                 Written to the `content` field per NIP-09.
 */
export function DeletionBlueprint(events: NostrEvent[], reason?: string) {
  return blueprint(
    5,
    setContent(reason ?? ""),
    // Add one `e` tag per event being deleted, plus a `k` tag for each unique kind
    modifyPublicTags((tags) => {
      const newTags = [...tags];
      const kindsAdded = new Set<number>();
      for (const ev of events) {
        newTags.push(["e", ev.id]);
        if (!kindsAdded.has(ev.kind)) {
          newTags.push(["k", String(ev.kind)]);
          kindsAdded.add(ev.kind);
        }
      }
      return newTags;
    }),
    includeAltTag(
      events.length === 1
        ? `Deletion request for event ${events[0].id.slice(0, 8)}…`
        : `Deletion request for ${events.length} events`,
    ),
  );
}

/**
 * Blueprint for a NIP-09 deletion request (kind 5) that targets an
 * addressable event via its `a` coordinate tag.
 *
 * Using an `a` tag instructs relays to delete ALL versions of the replaceable
 * event up to the `created_at` of the deletion request — i.e. the entire
 * repository announcement history, not just one version.
 *
 * @param aCoord - Addressable coordinate string: "<kind>:<pubkey>:<d-tag>"
 * @param kind   - The kind number of the event being deleted (for the `k` tag)
 * @param reason - Optional human-readable reason for the deletion request.
 */
export function AddressableDeletionBlueprint(
  aCoord: string,
  kind: number,
  reason?: string,
) {
  return blueprint(
    5,
    setContent(reason ?? ""),
    modifyPublicTags((tags) => [...tags, ["a", aCoord], ["k", String(kind)]]),
    includeAltTag(`Deletion request for ${aCoord}`),
  );
}
