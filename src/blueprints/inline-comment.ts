/**
 * InlineCommentBlueprint — NIP-22 comment (kind:1111) with code location tags.
 *
 * Extends the standard NIP-22 comment with the additional tags defined in
 * NIP.md for inline code review:
 *   ["f", "<path/to/file>"]          — file path
 *   ["c", "<commit-id>"]             — commit the comment targets
 *   ["line", "<line-or-range>"]      — line number or range (e.g. "42" or "42-48")
 *
 * The NIP-22 root (E/K/P) is always the PR (kind:1618) or patch (kind:1617).
 * The parent (e/k/p) is either the same event or a PR update (kind:1619) when
 * commenting on a specific revision.
 *
 * Repo coordinates are added as ["q", "<coord>", "<relay>"] tags — one per
 * maintainer — so relay queries can filter by repo.
 */

import type { EventTemplate } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";

export interface InlineCommentOptions {
  /** File path within the repo (e.g. "src/lib/foo.ts") */
  filePath: string;
  /** Commit ID the comment targets */
  commitId?: string;
  /** Line number or range (e.g. "42" or "42-48") */
  line?: string;
  /**
   * Which side of the diff the line number refers to.
   * "del" means the number is in the pre-commit (old) file — a deleted line.
   * Omit (or undefined) for added/context lines — the number is in the post-commit (new) file.
   */
  lineSide?: "del";
  /** Repo coordinate strings (e.g. "30617:<pubkey>:<d>") for q-tags */
  repoCoords?: string[];
  /** Relay hint for the root event */
  relayHint?: string;
}

/**
 * Build a NIP-22 inline comment event template.
 *
 * @param rootEvent   - The PR (kind:1618) or patch (kind:1617) being commented on
 * @param parentEvent - The immediate parent (same as rootEvent for top-level, or a PR update)
 * @param content     - Comment body
 * @param options     - Code location and repo context
 */
export function buildInlineCommentTemplate(
  rootEvent: NostrEvent,
  parentEvent: NostrEvent,
  content: string,
  options: InlineCommentOptions,
): EventTemplate {
  const relay = options.relayHint ?? "";

  const tags: string[][] = [
    // NIP-22 root — always the PR or patch
    ["E", rootEvent.id, relay, rootEvent.pubkey],
    ["K", String(rootEvent.kind)],
    ["P", rootEvent.pubkey, relay],

    // NIP-22 parent — same as root for top-level, or a PR update
    ["e", parentEvent.id, relay, parentEvent.pubkey],
    ["k", String(parentEvent.kind)],
    ["p", parentEvent.pubkey],
  ];

  // Repo q-tags — one per maintainer coordinate
  for (const coord of options.repoCoords ?? []) {
    tags.push(["q", coord, relay]);
  }

  // Code location tags
  tags.push(["f", options.filePath]);
  if (options.commitId) {
    tags.push(["c", options.commitId]);
  }
  if (options.line) {
    tags.push(
      options.lineSide === "del"
        ? ["line", options.line, "del"]
        : ["line", options.line],
    );
  }

  // NIP-31 alt tag for clients that don't understand inline comments
  tags.push(["alt", `Inline code review comment on ${options.filePath}`]);

  return {
    kind: 1111,
    content,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Parse the code location from an inline comment event.
 * Returns undefined for any field that is absent.
 */
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
 * Check whether a kind:1111 event is an inline code review comment
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
