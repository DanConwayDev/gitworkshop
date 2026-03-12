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
    modifyPublicTags((tags) => [
      ...tags,
      // Reference the target issue
      ["e", issueId],
      // Declare the namespace
      ["L", ISSUE_LABEL_NAMESPACE],
      // Add each label in the namespace
      ...labels.map((l) => ["l", l, ISSUE_LABEL_NAMESPACE]),
    ]),
  );
}
