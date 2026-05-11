/**
 * GitAuthorListFactory — NIP-51 Git authors follow list (kind 10017).
 *
 * Reuses `NIP51UserListFactory` from `applesauce-common/factories` which
 * provides `addUser`/`removeUser` semantics for pubkey-list kinds.
 *
 * Usage:
 * ```ts
 * import { GitAuthorListFactory } from "@/factories/GitAuthorListFactory";
 *
 * // Add to an existing list
 * const signed = await GitAuthorListFactory
 *   .modify(existingEvent)
 *   .addUser(pubkey)
 *   .sign(signer);
 *
 * // Create a fresh list
 * const signed = await GitAuthorListFactory
 *   .create()
 *   .addUser(pubkey)
 *   .sign(signer);
 * ```
 */

import { blankEventTemplate } from "applesauce-core/factories";
import { NIP51UserListFactory } from "applesauce-common/factories";
import type { KnownEventTemplate } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";

/** kind:10017 — NIP-51 Git authors follow list */
export const GIT_AUTHORS_KIND = 10017;

type GitAuthorListTemplate = KnownEventTemplate<typeof GIT_AUTHORS_KIND>;

export class GitAuthorListFactory extends NIP51UserListFactory<
  typeof GIT_AUTHORS_KIND,
  GitAuthorListTemplate
> {
  /** Start a fresh, empty kind:10017 list. */
  static create(): GitAuthorListFactory {
    return new GitAuthorListFactory((resolve) =>
      resolve(blankEventTemplate(GIT_AUTHORS_KIND)),
    );
  }

  /**
   * Modify an existing kind:10017 list event.
   *
   * Accepts a generic `NostrEvent` — callers are expected to only pass events
   * that are actually kind:10017. We copy the tags / content into a fresh
   * template (with a bumped `created_at`) so the replaceable event publishes
   * cleanly.
   */
  static modify(event: NostrEvent): GitAuthorListFactory {
    const template: KnownEventTemplate<typeof GIT_AUTHORS_KIND> = {
      kind: GIT_AUTHORS_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: Array.from(event.tags),
      content: event.content,
    };
    return new GitAuthorListFactory((resolve) => resolve(template));
  }
}
