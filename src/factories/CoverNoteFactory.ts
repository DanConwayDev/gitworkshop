/**
 * CoverNoteFactory — Cover note (kind 1624).
 *
 * A pinned note posted by the item author or a maintainer that appears above
 * the first description card on an issue or PR page. Mirrors gitworkshop's
 * CoverNote feature.
 *
 * Usage:
 * ```ts
 * import { CoverNoteFactory } from "@/factories/CoverNoteFactory";
 *
 * const signed = await CoverNoteFactory
 *   .create(rootEvent, "This PR is blocked on upstream changes.")
 *   .sign(signer);
 * ```
 */

import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import type { NostrEvent } from "nostr-tools";
import { COVER_NOTE_KIND } from "@/lib/nip34";
import type { KnownEventTemplate } from "applesauce-core/helpers/event";

export interface CoverNoteOptions {
  /**
   * Additional raw tags to append verbatim (e.g. NIP-94 `imeta` tags from
   * Blossom uploads). Each element is a tag tuple like `["imeta", "url ...", ...]`.
   */
  extraTags?: string[][];
}

type CoverNoteTemplate = KnownEventTemplate<typeof COVER_NOTE_KIND>;

export class CoverNoteFactory extends EventFactory<
  typeof COVER_NOTE_KIND,
  CoverNoteTemplate
> {
  /**
   * Create a cover note factory for an issue / PR / patch root event.
   *
   * @param rootEvent - The root issue / PR / patch event being annotated
   * @param content   - Markdown body of the cover note
   * @param options   - Optional: extraTags (e.g. imeta from Blossom uploads)
   */
  static create(
    rootEvent: NostrEvent,
    content: string,
    options?: CoverNoteOptions,
  ): CoverNoteFactory {
    let factory = new CoverNoteFactory((resolve) =>
      resolve(blankEventTemplate(COVER_NOTE_KIND)),
    )
      .content(content)
      .modifyPublicTags((tags) => [
        ...tags,
        ["e", rootEvent.id, "", "root"],
        ["p", rootEvent.pubkey],
        ["k", String(rootEvent.kind)],
      ])
      .alt("Cover note for a git issue or PR");

    const extraTags = options?.extraTags ?? [];
    if (extraTags.length > 0) {
      factory = factory.modifyPublicTags((tags) => [...tags, ...extraTags]);
    }

    return factory;
  }
}
