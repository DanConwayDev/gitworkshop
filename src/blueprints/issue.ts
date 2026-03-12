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
import { setContent, includeAltTag } from "applesauce-core/operations";
import { ISSUE_KIND } from "@/lib/nip34";
import {
  setSubject,
  addRepositoryTag,
  addRepositoryOwnerTag,
  addIssueLabel,
} from "@/operations/issue";

export interface IssueOptions {
  /** Optional labels to attach as `t` tags */
  labels?: string[];
}

/**
 * Blueprint for creating a NIP-34 git issue (kind 1621).
 *
 * @param repoCoord   - Repository coordinate: "30617:<pubkey>:<d-tag>"
 * @param ownerPubkey - Hex pubkey of the repository owner (added as `p` tag)
 * @param subject     - Issue title / subject line
 * @param content     - Markdown body of the issue
 * @param options     - Optional: labels
 */
export function IssueBlueprint(
  repoCoord: string,
  ownerPubkey: string,
  subject: string,
  content: string,
  options?: IssueOptions,
) {
  return blueprint(
    ISSUE_KIND,
    addRepositoryTag(repoCoord),
    addRepositoryOwnerTag(ownerPubkey),
    setSubject(subject),
    setContent(content),
    includeAltTag(`Git issue: ${subject}`),
    ...(options?.labels ?? []).map(addIssueLabel),
  );
}
