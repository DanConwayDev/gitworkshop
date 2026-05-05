/**
 * RepoAnnouncementFactory — NIP-34 repository announcement (kind 30617).
 *
 * Produces the event structure defined in NIP-34:
 *   - `d` tag: repo identifier (kebab-case slug)
 *   - `name` tag: human-readable project name
 *   - `description` tag: brief project description (optional, empty string allowed)
 *   - `clone` tag: git clone URL(s) — all URLs in a single tag
 *   - `relays` tag: relay URL(s) for monitoring patches/issues — all in a single tag
 *   - `r` tag with "euc" marker: earliest unique commit (root commit for new repos)
 *   - `alt` tag: NIP-31 human-readable description
 *
 * Usage:
 * ```ts
 * import { RepoAnnouncementFactory } from "@/factories/RepoAnnouncementFactory";
 *
 * const signed = await RepoAnnouncementFactory
 *   .create("my-repo", "My Repository", "A cool project",
 *           ["https://relay.ngit.dev/npub.../my-repo.git"],
 *           ["wss://relay.ngit.dev"],
 *           "abc123...")
 *   .sign(signer);
 * ```
 */

import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { REPO_KIND } from "@/lib/nip34";
import type { KnownEventTemplate } from "applesauce-core/helpers/event";

type RepoTemplate = KnownEventTemplate<typeof REPO_KIND>;

export class RepoAnnouncementFactory extends EventFactory<
  typeof REPO_KIND,
  RepoTemplate
> {
  /**
   * @param identifier    - The d-tag (kebab-case repo slug)
   * @param name          - Human-readable project name
   * @param description   - Brief project description (empty string if none)
   * @param cloneUrls     - Git clone URLs (at least one Grasp clone URL)
   * @param relayUrls     - Relay WebSocket URLs (at least one Grasp relay)
   * @param eucCommitHash - Earliest unique commit hash (the root commit)
   */
  static create(
    identifier: string,
    name: string,
    description: string,
    cloneUrls: string[],
    relayUrls: string[],
    eucCommitHash: string,
  ): RepoAnnouncementFactory {
    return (
      new RepoAnnouncementFactory((resolve) =>
        resolve(blankEventTemplate(REPO_KIND)),
      )
        // d tag (identifier) — use includeSingletonTag so it replaces any
        // auto-generated d tag the template added for addressable events.
        .chain(includeSingletonTag(["d", identifier], true))
        .modifyPublicTags((tags) => [
          ...tags,
          // name tag
          ["name", name],
          // description tag (include even if empty — matches ngit behaviour)
          ["description", description],
          // clone tag — all URLs in a single tag: ["clone", url1, url2, ...]
          ["clone", ...cloneUrls],
          // relays tag — all URLs in a single tag: ["relays", url1, url2, ...]
          ["relays", ...relayUrls],
          // r tag with EUC marker — earliest unique commit
          ["r", eucCommitHash, "euc"],
        ])
        .alt(`git repository: ${name}`)
    );
  }
}
