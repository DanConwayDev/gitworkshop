/**
 * IssueSubjectRenameFactory — NIP-32 label event (kind 1985) with the
 * `#subject` namespace, used to rename a NIP-34 issue's subject.
 *
 * Publishes a label event with the `#subject` namespace. The latest such
 * event from an authorised author becomes the issue's effective subject.
 *
 * Usage:
 * ```ts
 * import { IssueSubjectRenameFactory } from "@/factories/IssueSubjectRenameFactory";
 *
 * const signed = await IssueSubjectRenameFactory
 *   .create(issueId, "New subject")
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

/** The label namespace used for subject-rename events (NIP-32 `#subject`). */
const SUBJECT_RENAME_NAMESPACE = "#subject";

type LabelTemplate = KnownEventTemplate<typeof LABEL_KIND>;

export class IssueSubjectRenameFactory extends EventFactory<
  typeof LABEL_KIND,
  LabelTemplate
> {
  /**
   * @param issueId    - Hex event id of the issue being renamed
   * @param newSubject - The new subject/title string
   */
  static create(
    issueId: string,
    newSubject: string,
  ): IssueSubjectRenameFactory {
    return new IssueSubjectRenameFactory((resolve) =>
      resolve(blankEventTemplate(LABEL_KIND)),
    )
      .modifyPublicTags(addEventPointerTag(issueId, getEventRelayHint))
      .modifyPublicTags(addNameValueTag(["L", SUBJECT_RENAME_NAMESPACE]))
      .modifyPublicTags(
        addNameValueTag(["l", newSubject, SUBJECT_RENAME_NAMESPACE]),
      );
  }
}
