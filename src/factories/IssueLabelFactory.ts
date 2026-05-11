/**
 * IssueLabelFactory — NIP-32 label event (kind 1985) for attaching labels
 * to a NIP-34 issue.
 *
 * Labels are stored as `l` tags with namespace `#t`, and the namespace is
 * declared via an `L` tag.
 *
 * Usage:
 * ```ts
 * import { IssueLabelFactory } from "@/factories/IssueLabelFactory";
 *
 * const signed = await IssueLabelFactory
 *   .create(issueId, ["bug", "needs-triage"])
 *   .sign(signer);
 * ```
 */

import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import {
  addEventPointerTag,
  addNameValueTag,
} from "applesauce-core/operations/tag/common";
import { LABEL_KIND } from "@/lib/nip34";
import { getEventRelayHint } from "./hints";
import type { KnownEventTemplate } from "applesauce-core/helpers/event";

/** The label namespace used for issue labels (NIP-32 `#t` convention). */
export const ISSUE_LABEL_NAMESPACE = "#t";

type LabelTemplate = KnownEventTemplate<typeof LABEL_KIND>;

export class IssueLabelFactory extends EventFactory<
  typeof LABEL_KIND,
  LabelTemplate
> {
  /**
   * Create a NIP-32 label event attaching labels to an issue.
   *
   * @param issueId - Hex event id of the issue being labelled
   * @param labels  - One or more label strings (e.g. ["bug", "needs-triage"])
   */
  static create(issueId: string, labels: string[]): IssueLabelFactory {
    return new IssueLabelFactory((resolve) =>
      resolve(blankEventTemplate(LABEL_KIND)),
    )
      .modifyPublicTags(addEventPointerTag(issueId, getEventRelayHint))
      .modifyPublicTags(addNameValueTag(["L", ISSUE_LABEL_NAMESPACE]))
      .modifyPublicTags(
        ...labels.map((label) =>
          addNameValueTag(["l", label, ISSUE_LABEL_NAMESPACE]),
        ),
      );
  }
}
