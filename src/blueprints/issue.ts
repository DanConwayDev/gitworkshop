/**
 * NIP-34 Git Issue blueprint (kind 1621).
 *
 * Usage:
 * ```ts
 * import { factory } from "@/services/actions";
 * import { publish } from "@/services/nostr";
 * import { IssueBlueprint } from "@/blueprints/issue";
 *
 * const template = await factory.create(
 *   IssueBlueprint,
 *   "30617:<pubkey>:<d-tag>",
 *   "<owner-pubkey>",
 *   "Bug: crash on startup",
 *   "Steps to reproduce...",
 *   { labels: ["bug"] },
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
import { includeContentHashtags } from "applesauce-core/operations/content";
import { ISSUE_KIND } from "@/lib/nip34";
import {
  setSubject,
  addRepositoryTag,
  addRepositoryOwnerTag,
  addIssueLabel,
} from "@/operations/issue";
import type { NostrTag } from "@/lib/nostrContentTags";

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

/**
 * Blueprint for creating a NIP-34 git issue (kind 1621).
 *
 * @param repoCoord   - Repository coordinate: "30617:<pubkey>:<d-tag>"
 * @param ownerPubkey - Hex pubkey of the repository owner (added as `p` tag)
 * @param subject     - Issue title / subject line
 * @param content     - Markdown body of the issue
 * @param options     - Optional: labels, contentTags
 */
export function IssueBlueprint(
  repoCoord: string,
  ownerPubkey: string,
  subject: string,
  content: string,
  options?: IssueOptions,
) {
  const contentTags = options?.contentTags ?? [];
  const extraTags = options?.extraTags ?? [];
  return blueprint(
    ISSUE_KIND,
    addRepositoryTag(repoCoord),
    addRepositoryOwnerTag(ownerPubkey),
    setSubject(subject),
    setContent(content),
    includeContentHashtags(),
    includeAltTag(`Git issue: ${subject}`),
    ...(options?.labels ?? []).map(addIssueLabel),
    // Append p/q tags for NIP-19 references found in the body
    ...(contentTags.length > 0
      ? [modifyPublicTags((tags) => [...tags, ...contentTags])]
      : []),
    // Append any extra tags (e.g. imeta tags from Blossom uploads)
    ...(extraTags.length > 0
      ? [modifyPublicTags((tags) => [...tags, ...extraTags])]
      : []),
  );
}
