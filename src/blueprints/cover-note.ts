/**
 * Cover Note blueprint (kind 1624).
 *
 * A pinned note posted by the item author or a maintainer that appears above
 * the first description card on an issue or PR page. Mirrors gitworkshop's
 * CoverNote feature.
 *
 * Usage:
 * ```ts
 * import { factory } from "@/services/actions";
 * import { CoverNoteBlueprint } from "@/blueprints/cover-note";
 *
 * const template = await factory.create(
 *   CoverNoteBlueprint,
 *   rootEvent,
 *   "This PR is blocked on upstream changes.",
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
import { COVER_NOTE_KIND } from "@/lib/nip34";

/**
 * Blueprint for creating a cover note (kind 1624) for a NIP-34 issue or PR.
 *
 * @param rootEvent - The root issue / PR / patch event being annotated
 * @param content   - Markdown body of the cover note
 */
export function CoverNoteBlueprint(rootEvent: NostrEvent, content: string) {
  return blueprint(
    COVER_NOTE_KIND,
    setContent(content),
    modifyPublicTags((tags) => [
      ...tags,
      ["e", rootEvent.id, "", "root"],
      ["p", rootEvent.pubkey],
      ["k", String(rootEvent.kind)],
    ]),
    includeAltTag("Cover note for a git issue or PR"),
  );
}
