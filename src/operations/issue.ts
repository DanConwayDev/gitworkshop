/**
 * NIP-34 issue event operations.
 *
 * Composable tag setters used by IssueBlueprint. Uses applesauce tag
 * operations (addNameValueTag, setSingletonTag, addProfilePointerTag,
 * addAddressPointerTag) rather than raw array manipulation, so relay hints
 * are resolved automatically via ctx.getPubkeyRelayHint / getEventRelayHint.
 */

import type { EventOperation } from "applesauce-core/event-factory";
import {
  modifyPublicTags,
  includeSingletonTag,
} from "applesauce-core/operations";
import {
  addNameValueTag,
  addProfilePointerTag,
  addAddressPointerTag,
} from "applesauce-core/operations/tag/common";

/**
 * Sets the subject (title) tag on an issue event.
 * Replaces any existing subject tag.
 */
export function setSubject(subject: string): EventOperation {
  return includeSingletonTag(["subject", subject], true);
}

/**
 * Tags the issue as belonging to a repository coordinate.
 * Format: "30617:<pubkey>:<d-tag>"
 * Uses addAddressPointerTag so relay hints are resolved automatically.
 */
export function addRepositoryTag(repoCoord: string): EventOperation {
  return modifyPublicTags(addAddressPointerTag(repoCoord, false));
}

/**
 * Tags the repository owner as a `p` mention so they receive the issue.
 * Uses addProfilePointerTag so relay hints are resolved automatically.
 */
export function addRepositoryOwnerTag(ownerPubkey: string): EventOperation {
  return modifyPublicTags(addProfilePointerTag(ownerPubkey, false));
}

/**
 * Adds a label (`t` tag) to the issue.
 * Call multiple times to add multiple labels.
 */
export function addIssueLabel(label: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["t", label], false));
}
