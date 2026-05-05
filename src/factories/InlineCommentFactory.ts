/**
 * InlineCommentFactory — NIP-22 comment (kind 1111) with code-review
 * location tags.
 *
 * Extends the standard `CommentFactory` from `applesauce-common/factories`
 * with fluent methods for the additional tags defined in NIP.md for inline
 * code review:
 *
 *   ["f", "<path/to/file>"]           — file path
 *   ["c", "<commit-id>"]              — commit the comment targets
 *   ["line", "<line-or-range>"]       — line number or range (e.g. "42" or "42-48")
 *                                       optional third arg "del" for lines on
 *                                       the pre-commit (old) side of the diff
 *
 * Repo coordinates are added as ["q", "<coord>", "<relay>"] tags — one per
 * maintainer — so relay queries can filter by repo.
 *
 * The NIP-22 root (E/K/P) is always the PR (kind:1618) or patch (kind:1617).
 * The parent (e/k/p) is either the same event or a PR update (kind:1619) when
 * commenting on a specific revision.
 *
 * Usage:
 * ```ts
 * import { InlineCommentFactory } from "@/factories/InlineCommentFactory";
 *
 * const signed = await InlineCommentFactory
 *   .forLocation(rootEvent, parentEvent, content, { filePath, commitId, line, repoCoords })
 *   .sign(signer);
 *
 * // or fluent style
 * const signed = await InlineCommentFactory
 *   .create(rootEvent, parentEvent, content)
 *   .file("src/lib/foo.ts")
 *   .commit(commitId)
 *   .line("42-48")
 *   .repos(["30617:<pubkey>:<d>"])
 *   .sign(signer);
 * ```
 */

import { CommentFactory } from "applesauce-common/factories";
import { COMMENT_KIND } from "applesauce-common/helpers";
import { blankEventTemplate } from "applesauce-core/factories";
import type { NostrEvent } from "nostr-tools";

export interface InlineCommentLocation {
  /** File path within the repo (e.g. "src/lib/foo.ts") */
  filePath: string;
  /** Commit id the comment targets */
  commitId?: string;
  /** Line number or range (e.g. "42" or "42-48") */
  line?: string;
  /**
   * Which side of the diff the line number refers to.
   * "del" means the number is in the pre-commit (old) file — a deleted line.
   * Omit (or undefined) for added/context lines — the number is in the
   * post-commit (new) file.
   */
  lineSide?: "del";
  /** Repo coordinate strings (e.g. "30617:<pubkey>:<d>") for q-tags */
  repoCoords?: string[];
  /** Relay hint for `q` tags */
  relayHint?: string;
}

export class InlineCommentFactory extends CommentFactory {
  /**
   * Build an inline code-review comment factory.
   *
   * Uses `CommentFactory`'s `.parent(parentEvent)` to set the e/k/p tags
   * from the immediate parent. When `parentEvent !== rootEvent` the E/K/P
   * root tags are rewritten to point at the actual PR / patch.
   *
   * Named `forReview` (rather than `create`) because the base
   * `CommentFactory.create(parent, content, options)` has a different
   * signature and we mustn't shadow it incompatibly.
   *
   * @param rootEvent   - The PR (kind 1618) or patch (kind 1617) being reviewed
   * @param parentEvent - Immediate parent (same as `rootEvent`, or a PR update)
   * @param content     - Comment body
   */
  static forReview(
    rootEvent: NostrEvent,
    parentEvent: NostrEvent,
    content: string,
  ): InlineCommentFactory {
    let factory = new InlineCommentFactory((resolve) =>
      resolve(blankEventTemplate(COMMENT_KIND)),
    )
      .parent(parentEvent)
      .text(content);

    // When the parent isn't the root, overwrite the E/K/P root tags to point
    // at the actual PR / patch.
    if (parentEvent.id !== rootEvent.id) {
      factory = factory.modifyPublicTags((tags) => {
        const filtered = tags.filter(
          ([t]) => t !== "E" && t !== "K" && t !== "P",
        );
        return [
          ...filtered,
          ["E", rootEvent.id, "", rootEvent.pubkey],
          ["K", String(rootEvent.kind)],
          ["P", rootEvent.pubkey],
        ];
      });
    }

    return factory;
  }

  /**
   * Convenience static method that takes the full code-location object.
   */
  static forLocation(
    rootEvent: NostrEvent,
    parentEvent: NostrEvent,
    content: string,
    location: InlineCommentLocation,
  ): InlineCommentFactory {
    let factory = InlineCommentFactory.forReview(
      rootEvent,
      parentEvent,
      content,
    )
      .file(location.filePath)
      .alt(`Inline code review comment on ${location.filePath}`);

    if (location.commitId) factory = factory.commit(location.commitId);
    if (location.line) factory = factory.line(location.line, location.lineSide);
    if (location.repoCoords && location.repoCoords.length > 0) {
      factory = factory.repos(location.repoCoords, location.relayHint);
    }
    return factory;
  }

  /** Set the file-path `f` tag. */
  file(path: string): this {
    return this.modifyPublicTags((tags) => [
      ...tags.filter(([t]) => t !== "f"),
      ["f", path],
    ]);
  }

  /** Set the commit-id `c` tag. */
  commit(commitId: string): this {
    return this.modifyPublicTags((tags) => [
      ...tags.filter(([t]) => t !== "c"),
      ["c", commitId],
    ]);
  }

  /**
   * Set the `line` tag. `side = "del"` marks a line on the pre-commit (old)
   * side of the diff; omit for added / context lines.
   */
  line(line: string, side?: "del"): this {
    return this.modifyPublicTags((tags) => [
      ...tags.filter(([t]) => t !== "line"),
      side === "del" ? ["line", line, "del"] : ["line", line],
    ]);
  }

  /**
   * Add `q` tags — one per repo coordinate — so relay queries can filter by
   * repo.
   */
  repos(coords: string[], relayHint?: string): this {
    if (coords.length === 0) return this;
    return this.modifyPublicTags((tags) => [
      ...tags,
      ...coords.map((c) => ["q", c, relayHint ?? ""]),
    ]);
  }
}
