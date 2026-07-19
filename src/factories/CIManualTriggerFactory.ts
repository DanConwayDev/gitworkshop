/**
 * CIManualTriggerFactory — ngit-ci manual workflow trigger (kind:9840).
 *
 * A trigger copies the repository and trigger context from a completed
 * workflow result, targets that result's coordinator, and intentionally omits
 * the result's `o` trigger tag: kind:9840 is always normalized as `manual`.
 */

import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import type { KnownEventTemplate } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import { CI_MANUAL_TRIGGER_KIND } from "@/lib/ci";

type CIManualTriggerTemplate = KnownEventTemplate<
  typeof CI_MANUAL_TRIGGER_KIND
>;

/** Tags that identify a workflow's repository and trigger context. */
const RETRY_CONTEXT_TAGS = new Set([
  "a",
  "c",
  "w",
  "r",
  "E",
  "K",
  "P",
  "e",
  "k",
  "p",
]);

export class CIManualTriggerFactory extends EventFactory<
  typeof CI_MANUAL_TRIGGER_KIND,
  CIManualTriggerTemplate
> {
  /**
   * Request a new manual attempt of a completed workflow result.
   *
   * The coordinator is the original workflow-result author. Existing lowercase
   * `p` tags are retained for NIP-22 PR context; the coordinator receives its
   * own `p` tag as required by the CI manual-trigger event shape.
   */
  static create(
    workflowResult: NostrEvent,
    coordinatorPubkey: string,
  ): CIManualTriggerFactory {
    const isPullRequestRun = workflowResult.tags.some(([name]) => name === "E");
    const contextTags = workflowResult.tags
      .filter(
        ([name]) =>
          RETRY_CONTEXT_TAGS.has(name) && (name !== "p" || isPullRequestRun),
      )
      .map((tag) => [...tag]);

    return new CIManualTriggerFactory((resolve) =>
      resolve(blankEventTemplate(CI_MANUAL_TRIGGER_KIND)),
    )
      .modifyPublicTags((tags) => [
        ...tags,
        ["p", coordinatorPubkey],
        ...contextTags,
      ])
      .alt("Manual CI workflow trigger");
  }
}
