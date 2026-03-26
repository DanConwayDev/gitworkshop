/**
 * NIP-32 Label blueprint (kind 1985).
 *
 * Attaches one or more labels to a target event using the `#t` namespace.
 * Labels are stored as `l` tags with namespace `#t`, and the namespace is
 * declared via an `L` tag.
 *
 * Usage:
 * ```ts
 * import { factory } from "@/services/actions";
 * import { publish } from "@/services/nostr";
 * import { IssueLabelBlueprint } from "@/blueprints/label";
 *
 * const template = await factory.create(
 *   IssueLabelBlueprint,
 *   "<issue-event-id>",
 *   ["bug", "needs-triage"],
 * );
 * const signed = await factory.sign(template);
 * await publish(signed);
 * ```
 */

import { blueprint } from "applesauce-core/event-factory";
import { modifyPublicTags } from "applesauce-core/operations";
import {
  addEventPointerTag,
  addNameValueTag,
} from "applesauce-core/operations/tag/common";
import { LABEL_KIND } from "@/lib/nip34";

/** The label namespace used for issue labels (NIP-32 `#t` convention). */
export const ISSUE_LABEL_NAMESPACE = "#t";

/**
 * Blueprint for attaching labels to a NIP-34 issue via NIP-32 (kind 1985).
 *
 * @param issueId - Hex event ID of the issue being labelled
 * @param labels  - One or more label strings (e.g. ["bug", "needs-triage"])
 */
export function IssueLabelBlueprint(issueId: string, labels: string[]) {
  return blueprint(
    LABEL_KIND,
    // Reference the target issue — addEventPointerTag resolves relay hints
    // via ctx.getEventRelayHint automatically.
    modifyPublicTags(addEventPointerTag(issueId, false)),
    // Declare the namespace
    modifyPublicTags(addNameValueTag(["L", ISSUE_LABEL_NAMESPACE], false)),
    // Add each label in the namespace
    ...labels.map((l) =>
      modifyPublicTags(addNameValueTag(["l", l, ISSUE_LABEL_NAMESPACE], false)),
    ),
  );
}

/** The label namespace used for subject-rename events (NIP-32 `#subject`). */
export const SUBJECT_RENAME_NAMESPACE = "#subject";

/**
 * Blueprint for renaming an issue's subject via NIP-32 (kind 1985).
 *
 * Publishes a label event with the `#subject` namespace. The latest such
 * event from an authorised author becomes the issue's effective subject.
 *
 * @param issueId    - Hex event ID of the issue being renamed
 * @param newSubject - The new subject/title string
 */
export function IssueSubjectRenameBlueprint(
  issueId: string,
  newSubject: string,
) {
  return blueprint(
    LABEL_KIND,
    // Reference the target issue — addEventPointerTag resolves relay hints
    // via ctx.getEventRelayHint automatically.
    modifyPublicTags(addEventPointerTag(issueId, false)),
    // Declare the namespace
    modifyPublicTags(addNameValueTag(["L", SUBJECT_RENAME_NAMESPACE], false)),
    // The new subject as a label in the #subject namespace
    modifyPublicTags(
      addNameValueTag(["l", newSubject, SUBJECT_RENAME_NAMESPACE], false),
    ),
  );
}
