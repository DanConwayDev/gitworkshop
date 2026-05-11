/**
 * PinnedReposFactory — NIP-51 pinned git repositories list (kind 10617).
 *
 * Pinned repos are a curated, ordered list of the user's own repositories
 * that they want to highlight on their profile. The order of `a` tags in the
 * event is preserved and used for display ordering.
 *
 * Extends `NIP51ItemListFactory` (add/remove address items) and also exposes
 * a `reorder(...)` method that replaces the entire `a` tag sequence while
 * preserving existing relay hints.
 *
 * Usage:
 * ```ts
 * import { PinnedReposFactory } from "@/factories/PinnedReposFactory";
 *
 * // Pin a repo
 * const signed = await PinnedReposFactory
 *   .modify(existingEvent)
 *   .addAddressItem("30617:<pubkey>:<dtag>")
 *   .sign(signer);
 *
 * // Reorder
 * const signed = await PinnedReposFactory
 *   .modify(existingEvent)
 *   .reorder(orderedCoords)
 *   .sign(signer);
 * ```
 */

import { blankEventTemplate } from "applesauce-core/factories";
import { NIP51ItemListFactory } from "applesauce-common/factories";
import type { KnownEventTemplate } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";

/** kind:10617 — pinned git repositories list */
export const PINNED_REPOS_KIND = 10617;

type PinnedReposTemplate = KnownEventTemplate<typeof PINNED_REPOS_KIND>;

export class PinnedReposFactory extends NIP51ItemListFactory<
  typeof PINNED_REPOS_KIND,
  PinnedReposTemplate
> {
  /** Start a fresh, empty kind:10617 list. */
  static create(): PinnedReposFactory {
    return new PinnedReposFactory((resolve) =>
      resolve(blankEventTemplate(PINNED_REPOS_KIND)),
    );
  }

  /** Modify an existing kind:10617 list event. */
  static modify(event: NostrEvent): PinnedReposFactory {
    const template: KnownEventTemplate<typeof PINNED_REPOS_KIND> = {
      kind: PINNED_REPOS_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: Array.from(event.tags),
      content: event.content,
    };
    return new PinnedReposFactory((resolve) => resolve(template));
  }

  /**
   * Replace the entire ordered sequence of pinned repo coordinates, preserving
   * any existing relay hints on unchanged entries.
   *
   * @param coords - Ordered array of "30617:<pubkey>:<dtag>" coordinate strings
   */
  reorder(coords: string[]): this {
    return this.modifyPublicTags((tags) => {
      const existingATags = tags.filter(([t]) => t === "a");
      const otherTags = tags.filter(([t]) => t !== "a");
      const newATags = coords.map((coord) => {
        const original = existingATags.find(([, v]) => v === coord);
        return original ?? ["a", coord];
      });
      return [...otherTags, ...newATags];
    });
  }
}
