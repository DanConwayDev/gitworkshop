/**
 * RepoStateFactory — NIP-34 repository state event (kind 30618).
 *
 * Produces the event structure defined in NIP-34:
 *   - `d` tag: repo identifier (must match the announcement)
 *   - ref tags: one per branch/tag, e.g. ["refs/heads/main", "<commit-hash>"]
 *   - HEAD tag: symbolic ref, e.g. ["HEAD", "ref: refs/heads/main"]
 *
 * Usage:
 * ```ts
 * import { RepoStateFactory } from "@/factories/RepoStateFactory";
 *
 * const signed = await RepoStateFactory
 *   .create("my-repo", "abc123...", "main")
 *   .sign(signer);
 * ```
 */

import {
  blankEventTemplate,
  EventFactory,
  toEventTemplate,
} from "applesauce-core/factories";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { REPO_STATE_KIND } from "@/lib/nip34";
import type {
  KnownEvent,
  KnownEventTemplate,
} from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";

type RepoStateTemplate = KnownEventTemplate<typeof REPO_STATE_KIND>;

export class RepoStateFactory extends EventFactory<
  typeof REPO_STATE_KIND,
  RepoStateTemplate
> {
  /**
   * @param identifier - The d-tag (must match the corresponding announcement)
   * @param commitHash - The commit hash for the default branch
   * @param branchName - The default branch name (default: "main")
   */
  static create(
    identifier: string,
    commitHash: string,
    branchName: string = "main",
  ): RepoStateFactory {
    return (
      new RepoStateFactory((resolve) =>
        resolve(blankEventTemplate(REPO_STATE_KIND)),
      )
        // d tag (identifier) — replace any auto-generated d tag
        .chain(includeSingletonTag(["d", identifier], true))
        .modifyPublicTags((tags) => [
          ...tags,
          // ref tag for the default branch
          [`refs/heads/${branchName}`, commitHash],
          // HEAD symbolic ref
          ["HEAD", `ref: refs/heads/${branchName}`],
        ])
    );
  }

  /**
   * Create an updated state event from an existing repository state, preserving
   * every declared branch/tag and replacing only the target branch plus HEAD.
   *
   * Existing repositories need the full post-push ref set in kind:30618; Grasp
   * rejects pushes whose state event omits branches/tags that will still exist.
   * Use this for merges and other branch updates. `create` remains appropriate
   * for brand-new single-branch repositories.
   */
  static updateBranch(
    identifier: string,
    existingState: NostrEvent | null | undefined,
    commitHash: string,
    branchName: string = "main",
  ): RepoStateFactory {
    const branchRef = `refs/heads/${branchName}`;

    return new RepoStateFactory((resolve) => {
      if (existingState?.kind === REPO_STATE_KIND) {
        resolve(
          toEventTemplate(existingState as KnownEvent<typeof REPO_STATE_KIND>),
        );
      } else {
        resolve(blankEventTemplate(REPO_STATE_KIND));
      }
    })
      .chain(includeSingletonTag(["d", identifier], true))
      .modifyPublicTags((tags) => [
        ...tags.filter(
          ([tagName]) => tagName !== branchRef && tagName !== "HEAD",
        ),
        [branchRef, commitHash],
        ["HEAD", `ref: ${branchRef}`],
      ]);
  }
}
