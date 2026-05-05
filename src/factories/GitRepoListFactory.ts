/**
 * GitRepoListFactory — NIP-51 Git repositories follow list (kind 10018).
 *
 * Reuses `NIP51ItemListFactory` from `applesauce-common/factories` which
 * provides `addAddressItem`/`removeAddressItem` semantics for
 * repo-announcement (kind:30617) coordinate lists.
 *
 * Usage:
 * ```ts
 * import { GitRepoListFactory } from "@/factories/GitRepoListFactory";
 *
 * // Add a repo to an existing list
 * const signed = await GitRepoListFactory
 *   .modify(existingEvent)
 *   .addAddressItem("30617:<pubkey>:<dtag>")
 *   .sign(signer);
 *
 * // Create a fresh list
 * const signed = await GitRepoListFactory
 *   .create()
 *   .addAddressItem("30617:<pubkey>:<dtag>")
 *   .sign(signer);
 * ```
 */

import { blankEventTemplate } from "applesauce-core/factories";
import { NIP51ItemListFactory } from "applesauce-common/factories";
import type { KnownEventTemplate } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";

/** kind:10018 — NIP-51 Git repositories follow list */
export const GIT_REPOS_KIND = 10018;

type GitRepoListTemplate = KnownEventTemplate<typeof GIT_REPOS_KIND>;

export class GitRepoListFactory extends NIP51ItemListFactory<
  typeof GIT_REPOS_KIND,
  GitRepoListTemplate
> {
  /** Start a fresh, empty kind:10018 list. */
  static create(): GitRepoListFactory {
    return new GitRepoListFactory((resolve) =>
      resolve(blankEventTemplate(GIT_REPOS_KIND)),
    );
  }

  /** Modify an existing kind:10018 list event. */
  static modify(event: NostrEvent): GitRepoListFactory {
    const template: KnownEventTemplate<typeof GIT_REPOS_KIND> = {
      kind: GIT_REPOS_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: Array.from(event.tags),
      content: event.content,
    };
    return new GitRepoListFactory((resolve) => resolve(template));
  }
}
