/**
 * Pure parsing helpers for NIP-22 comments (kind:1111) that carry inline
 * code-review metadata (f / c / line / q tags).
 *
 * Splits parsing from event creation: event creation lives in
 * `@/factories/InlineCommentFactory`; this module holds the read-side
 * helpers consumed by the UI.
 */

import type { NostrEvent } from "nostr-tools";

export interface InlineCommentLocation {
  filePath: string | undefined;
  commitId: string | undefined;
  line: string | undefined;
  /** Parsed line range: [start, end] (both inclusive). Single-line = [n, n]. */
  lineRange: [number, number] | undefined;
  /**
   * Which side of the diff the line number refers to.
   * "del" = pre-commit (old) file — deleted lines.
   * undefined = post-commit (new) file — added or context lines.
   */
  lineSide: "del" | undefined;
}

export function parseInlineCommentLocation(
  event: NostrEvent,
): InlineCommentLocation {
  const filePath = event.tags.find(([t]) => t === "f")?.[1];
  const commitId = event.tags.find(([t]) => t === "c")?.[1];
  const lineTag = event.tags.find(([t]) => t === "line");
  const line = lineTag?.[1];
  const lineSide = lineTag?.[2] === "del" ? "del" : undefined;

  let lineRange: [number, number] | undefined;
  if (line) {
    const parts = line.split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : start;
    if (!isNaN(start) && !isNaN(end)) {
      lineRange = [start, end];
    }
  }

  return { filePath, commitId, line, lineRange, lineSide };
}

/**
 * Check whether a kind:1111 event is an inline code-review comment
 * (has an "f" file-path tag).
 */
export function isInlineComment(event: NostrEvent): boolean {
  return event.kind === 1111 && event.tags.some(([t]) => t === "f");
}

/**
 * Get the root event ID from a NIP-22 comment (uppercase E tag).
 */
export function getCommentRootId(event: NostrEvent): string | undefined {
  return event.tags.find(([t]) => t === "E")?.[1];
}
