/**
 * IssueFactory — NIP-34 git issue (kind 1621).
 *
 * Replaces v5 `IssueBlueprint` + `src/operations/issue.ts`.
 *
 * Usage:
 * ```ts
 * import { IssueFactory } from "@/factories/IssueFactory";
 *
 * const signed = await IssueFactory
 *   .create(repoCoord, ownerPubkey, subject, content, { labels: ["bug"] })
 *   .sign(signer);
 * ```
 */

import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { includeContentHashtags } from "applesauce-core/operations/content";
import {
  addAddressPointerTag,
  addNameValueTag,
  addProfilePointerTag,
} from "applesauce-core/operations/tag/common";
import { ISSUE_KIND } from "@/lib/nip34";
import { getEventRelayHint, getPubkeyRelayHint } from "./hints";
import type { NostrTag } from "@/lib/nostrContentTags";
import type { KnownEventTemplate } from "applesauce-core/helpers/event";

export interface IssueOptions {
  /** Optional labels to attach as `t` tags */
  labels?: string[];
  /**
   * Extra tags derived from NIP-19 references in the issue body.
   * Use `extractContentTags(content)` to generate these.
   * Produces `p` tags for profile mentions and `q` tags for event/address references.
   */
  contentTags?: NostrTag[];
  /**
   * Additional raw tags to append verbatim (e.g. NIP-94 `imeta` tags from
   * Blossom uploads). Each element is a tag tuple like `["imeta", "url ...", ...]`.
   */
  extraTags?: string[][];
}

type IssueTemplate = KnownEventTemplate<typeof ISSUE_KIND>;

export class IssueFactory extends EventFactory<
  typeof ISSUE_KIND,
  IssueTemplate
> {
  /**
   * Create a new NIP-34 git issue factory.
   *
   * @param repoCoord   - Repository coordinate: "30617:<pubkey>:<d-tag>"
   * @param ownerPubkey - Hex pubkey of the repository owner (added as `p` tag)
   * @param subject     - Issue title / subject line
   * @param content     - Markdown body of the issue
   * @param options     - Optional: labels, contentTags, extraTags
   */
  static create(
    repoCoord: string,
    ownerPubkey: string,
    subject: string,
    content: string,
    options?: IssueOptions,
  ): IssueFactory {
    let factory = new IssueFactory((resolve) =>
      resolve(blankEventTemplate(ISSUE_KIND)),
    )
      .content(content)
      .modifyPublicTags(
        addAddressPointerTag(repoCoord, getPubkeyRelayHint),
        addProfilePointerTag(ownerPubkey, getPubkeyRelayHint),
      )
      .modifyPublicTags((tags) => [...tags, ["subject", subject]])
      .chain(includeContentHashtags())
      .alt(`Git issue: ${subject}`);

    const labels = options?.labels ?? [];
    if (labels.length > 0) {
      factory = factory.modifyPublicTags(
        ...labels.map((label) => addNameValueTag(["t", label])),
      );
    }

    const contentTags = options?.contentTags ?? [];
    if (contentTags.length > 0) {
      factory = factory.modifyPublicTags((tags) => [...tags, ...contentTags]);
    }

    const extraTags = options?.extraTags ?? [];
    if (extraTags.length > 0) {
      factory = factory.modifyPublicTags((tags) => [...tags, ...extraTags]);
    }

    return factory;
  }

  /** Add a single label (`t` tag). */
  label(label: string): this {
    return this.modifyPublicTags(addNameValueTag(["t", label]));
  }

  /** Add raw tag tuples (e.g. NIP-94 `imeta` tags). */
  extraTags(extraTags: string[][]): this {
    if (extraTags.length === 0) return this;
    return this.modifyPublicTags((tags) => [...tags, ...extraTags]);
  }
}

// Re-export relay hint helpers used by the factory, so callers that want to
// add their own ad-hoc tags with matching hint resolution can reuse them.
export { getEventRelayHint, getPubkeyRelayHint };
