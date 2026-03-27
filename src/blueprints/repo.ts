/**
 * NIP-34 Repository blueprints — kind:30617 (announcement) and kind:30618 (state).
 *
 * Used by the repo creation flow to build event templates for publishing
 * to Grasp servers and relay networks.
 *
 * Usage:
 * ```ts
 * import { factory } from "@/services/actions";
 * import { RepoAnnouncementBlueprint, RepoStateBlueprint } from "@/blueprints/repo";
 *
 * const announcement = await factory.create(
 *   RepoAnnouncementBlueprint,
 *   "my-repo",
 *   "My Repository",
 *   "A cool project",
 *   ["https://relay.ngit.dev/npub1.../my-repo.git"],
 *   ["wss://relay.ngit.dev"],
 *   "abc123...",
 * );
 * ```
 */

import { blueprint } from "applesauce-core/event-factory";
import { includeAltTag, modifyPublicTags } from "applesauce-core/operations";
import { REPO_KIND, REPO_STATE_KIND } from "@/lib/nip34";

// ---------------------------------------------------------------------------
// kind:30617 — Repository Announcement
// ---------------------------------------------------------------------------

/**
 * Blueprint for creating a NIP-34 repository announcement (kind 30617).
 *
 * Produces the event structure defined in NIP-34:
 *   - `d` tag: repo identifier (kebab-case slug)
 *   - `name` tag: human-readable project name
 *   - `description` tag: brief project description (optional)
 *   - `clone` tag: git clone URL(s)
 *   - `relays` tag: relay URL(s) for monitoring patches/issues
 *   - `r` tag with "euc" marker: earliest unique commit (root commit for new repos)
 *   - `alt` tag: NIP-31 human-readable description
 *
 * @param identifier    - The d-tag (kebab-case repo slug)
 * @param name          - Human-readable project name
 * @param description   - Brief project description (empty string if none)
 * @param cloneUrls     - Git clone URLs (at least one Grasp clone URL)
 * @param relayUrls     - Relay WebSocket URLs (at least one Grasp relay)
 * @param eucCommitHash - Earliest unique commit hash (the root commit)
 */
export function RepoAnnouncementBlueprint(
  identifier: string,
  name: string,
  description: string,
  cloneUrls: string[],
  relayUrls: string[],
  eucCommitHash: string,
) {
  return blueprint(
    REPO_KIND,
    // d tag (identifier)
    modifyPublicTags((tags) => [...tags, ["d", identifier]]),
    // r tag with EUC marker — earliest unique commit
    modifyPublicTags((tags) => [...tags, ["r", eucCommitHash, "euc"]]),
    // name tag
    modifyPublicTags((tags) => [...tags, ["name", name]]),
    // description tag (include even if empty — matches ngit behaviour)
    modifyPublicTags((tags) => [...tags, ["description", description]]),
    // clone tag — all URLs in a single tag: ["clone", url1, url2, ...]
    modifyPublicTags((tags) => [...tags, ["clone", ...cloneUrls]]),
    // relays tag — all URLs in a single tag: ["relays", url1, url2, ...]
    modifyPublicTags((tags) => [...tags, ["relays", ...relayUrls]]),
    // NIP-31 alt tag
    includeAltTag(`git repository: ${name}`),
  );
}

// ---------------------------------------------------------------------------
// kind:30618 — Repository State
// ---------------------------------------------------------------------------

/**
 * Blueprint for creating a NIP-34 repository state event (kind 30618).
 *
 * Produces the event structure defined in NIP-34:
 *   - `d` tag: repo identifier (must match the announcement)
 *   - ref tags: one per branch/tag, e.g. ["refs/heads/main", "<commit-hash>"]
 *   - HEAD tag: symbolic ref, e.g. ["HEAD", "ref: refs/heads/main"]
 *
 * @param identifier  - The d-tag (must match the corresponding announcement)
 * @param commitHash  - The commit hash for the default branch
 * @param branchName  - The default branch name (default: "main")
 */
export function RepoStateBlueprint(
  identifier: string,
  commitHash: string,
  branchName: string = "main",
) {
  return blueprint(
    REPO_STATE_KIND,
    // d tag (identifier)
    modifyPublicTags((tags) => [...tags, ["d", identifier]]),
    // ref tag for the default branch
    modifyPublicTags((tags) => [
      ...tags,
      [`refs/heads/${branchName}`, commitHash],
    ]),
    // HEAD symbolic ref
    modifyPublicTags((tags) => [
      ...tags,
      ["HEAD", `ref: refs/heads/${branchName}`],
    ]),
  );
}
