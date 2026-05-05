/**
 * DeletionFactory — NIP-09 deletion request (kind 5).
 *
 * Two entry points:
 *   - `DeletionFactory.forEvents(events, reason?)`
 *       Delete specific event versions via `e` tags. One `e` tag per event,
 *       plus a `k` tag for each unique kind.
 *   - `DeletionFactory.forAddressable(coord, kind, reason?)`
 *       Delete all versions of a replaceable/addressable event via an `a`
 *       coordinate tag. Tells relays to delete every event with that
 *       (kind, pubkey, d-tag) up to `created_at`.
 *
 * Usage:
 * ```ts
 * import { DeletionFactory } from "@/factories/DeletionFactory";
 *
 * const signed = await DeletionFactory
 *   .forEvents([reactionEvent], "Changed my mind")
 *   .sign(signer);
 * ```
 */

import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import type { KnownEventTemplate } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";

const DELETION_KIND = 5;
type DeletionTemplate = KnownEventTemplate<typeof DELETION_KIND>;

export class DeletionFactory extends EventFactory<
  typeof DELETION_KIND,
  DeletionTemplate
> {
  /**
   * Delete one or more specific event versions via `e` tags.
   *
   * @param events - One or more events to request deletion of (must share the
   *                 same pubkey as the signer — relays enforce this).
   * @param reason - Optional human-readable reason. Written to the `content`
   *                 field per NIP-09.
   */
  static forEvents(events: NostrEvent[], reason?: string): DeletionFactory {
    return new DeletionFactory((resolve) =>
      resolve(blankEventTemplate(DELETION_KIND)),
    )
      .content(reason ?? "")
      .modifyPublicTags((tags) => {
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
      })
      .alt(
        events.length === 1
          ? `Deletion request for event ${events[0].id.slice(0, 8)}…`
          : `Deletion request for ${events.length} events`,
      );
  }

  /**
   * Delete ALL versions of an addressable/replaceable event.
   *
   * Using an `a` tag instructs relays to delete ALL versions of the event up
   * to the `created_at` of the deletion request — i.e. the entire
   * replaceable-event history, not just one version.
   *
   * @param aCoord - Addressable coordinate string: "<kind>:<pubkey>:<d-tag>"
   * @param kind   - The kind number of the event being deleted (for the `k` tag)
   * @param reason - Optional human-readable reason.
   */
  static forAddressable(
    aCoord: string,
    kind: number,
    reason?: string,
  ): DeletionFactory {
    return new DeletionFactory((resolve) =>
      resolve(blankEventTemplate(DELETION_KIND)),
    )
      .content(reason ?? "")
      .modifyPublicTags((tags) => [...tags, ["a", aCoord], ["k", String(kind)]])
      .alt(`Deletion request for ${aCoord}`);
  }
}
