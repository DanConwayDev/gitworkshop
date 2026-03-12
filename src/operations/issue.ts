/**
 * NIP-34 issue event operations.
 *
 * These are composable tag/content setters used by IssueBlueprint.
 * Each operation is a pure function that transforms an EventTemplate.
 */

import type { EventOperation } from "applesauce-core/event-factory";
import { modifyPublicTags } from "applesauce-core/operations";

/**
 * Sets the subject (title) tag on an issue event.
 * Replaces any existing subject tag.
 */
export function setSubject(subject: string): EventOperation {
  return modifyPublicTags((tags) => {
    const filtered = tags.filter(([t]) => t !== "subject");
    return [...filtered, ["subject", subject]];
  });
}

/**
 * Tags the issue as belonging to a repository coordinate.
 * Format: "30617:<pubkey>:<d-tag>"
 */
export function addRepositoryTag(repoCoord: string): EventOperation {
  return modifyPublicTags((tags) => [...tags, ["a", repoCoord]]);
}

/**
 * Tags the repository owner as a `p` mention so they receive the issue.
 */
export function addRepositoryOwnerTag(ownerPubkey: string): EventOperation {
  return modifyPublicTags((tags) => [...tags, ["p", ownerPubkey]]);
}

/**
 * Adds a label (`t` tag) to the issue.
 * Call multiple times to add multiple labels.
 */
export function addIssueLabel(label: string): EventOperation {
  return modifyPublicTags((tags) => [...tags, ["t", label]]);
}
