// ---------------------------------------------------------------------------
// File viewer (CodeBlock) line anchor helpers
// ---------------------------------------------------------------------------

/**
 * Stable DOM id for a specific line in a file content viewer (CodeBlock).
 *
 * Format: `code-{sanitised_path}_L{lineNumber}`
 *
 * The `filePath` should be the repo-root-relative path (e.g. "src/lib/foo.ts").
 */
export function codeLineAnchorId(filePath: string, lineNumber: number): string {
  const sanitised = filePath.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `code-${sanitised}_L${lineNumber}`;
}

/**
 * Build a URL hash fragment for a file-viewer line range.
 *
 * Single line:  "#code-src_lib_foo_ts_L42"
 * Range:        "#code-src_lib_foo_ts_L42-L48"
 */
export function codeLineRangeHash(
  filePath: string,
  startLine: number,
  endLine: number,
): string {
  const sanitised = filePath.replace(/[^a-zA-Z0-9_-]/g, "_");
  const base = `code-${sanitised}`;
  if (startLine === endLine) {
    return `#${base}_L${startLine}`;
  }
  return `#${base}_L${startLine}-L${endLine}`;
}

/**
 * Parsed result of a code-viewer hash fragment.
 */
export interface ParsedCodeHash {
  /** The sanitised file path segment (without "code-" prefix). */
  sanitisedPath: string;
  /** DOM element ID of the first line in the range (for scrolling). */
  lineId: string | null;
  startLine: number | null;
  endLine: number | null;
}

/**
 * Parse a URL hash fragment into a file path and optional line range.
 *
 * Accepts hashes of the form:
 *   #code-src_lib_foo_ts_L42        → single line
 *   #code-src_lib_foo_ts_L42-L48    → range
 *   #code-src_lib_foo_ts            → file only (no line)
 *
 * Returns null if the hash doesn't match a code anchor pattern.
 */
export function parseCodeLineHash(hash: string): ParsedCodeHash | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith("code-")) return null;

  // Range anchor: code-{path}_L{start}-L{end}
  const rangeMatch = raw.match(/^(code-.+?)_L(\d+)-L(\d+)$/);
  if (rangeMatch) {
    const sanitisedPath = rangeMatch[1].slice("code-".length);
    const startLine = parseInt(rangeMatch[2], 10);
    const endLine = parseInt(rangeMatch[3], 10);
    const lineId = `code-${sanitisedPath}_L${startLine}`;
    return { sanitisedPath, lineId, startLine, endLine };
  }

  // Single line anchor: code-{path}_L{n}
  const lineMatch = raw.match(/^(code-.+?)_L(\d+)$/);
  if (lineMatch) {
    const sanitisedPath = lineMatch[1].slice("code-".length);
    const lineNum = parseInt(lineMatch[2], 10);
    return { sanitisedPath, lineId: raw, startLine: lineNum, endLine: lineNum };
  }

  // File-only anchor
  const sanitisedPath = raw.slice("code-".length);
  return { sanitisedPath, lineId: null, startLine: null, endLine: null };
}

// ---------------------------------------------------------------------------
// Diff card helpers
// ---------------------------------------------------------------------------

/** Stable DOM id for a file's diff card — used for scroll targeting. */
export function fileDiffCardId(filename: string): string {
  return "diff-" + filename.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Stable DOM id for a specific line within a diff card.
 *
 * Format:
 *   `{fileDiffCardId(filename)}_L{lineNumber}`   — added or context lines (new-file side)
 *   `{fileDiffCardId(filename)}_DL{lineNumber}`  — deleted lines (old-file side)
 *
 * These IDs are used as URL hash anchors so inline comment banners can link
 * directly to the relevant line in the Files Changed or commit diff view.
 */
export function diffLineAnchorId(
  filename: string,
  lineNumber: number,
  side: "new" | "del",
): string {
  const prefix = side === "del" ? "DL" : "L";
  return `${fileDiffCardId(filename)}_${prefix}${lineNumber}`;
}

/**
 * Build a URL hash fragment for a diff line anchor.
 * Returns a string like "#diff-src_lib_foo_ts_L42".
 */
export function diffLineHash(
  filename: string,
  lineNumber: number,
  side: "new" | "del",
): string {
  return "#" + diffLineAnchorId(filename, lineNumber, side);
}

/**
 * Build a URL hash fragment for a diff line range anchor.
 *
 * Single line:  "#diff-src_lib_foo_ts_L42"
 * Range:        "#diff-src_lib_foo_ts_L42-L48"
 * Deleted:      "#diff-src_lib_foo_ts_DL10-DL15"
 */
export function diffLineRangeHash(
  filename: string,
  startLine: number,
  endLine: number,
  side: "new" | "del",
): string {
  const prefix = side === "del" ? "DL" : "L";
  const cardId = fileDiffCardId(filename);
  if (startLine === endLine) {
    return `#${cardId}_${prefix}${startLine}`;
  }
  return `#${cardId}_${prefix}${startLine}-${prefix}${endLine}`;
}

/**
 * Parsed result of a diff hash fragment.
 *
 * `lineId`      — the DOM element ID to scroll to (the start line)
 * `startLine`   — numeric start of the selection range (or null)
 * `endLine`     — numeric end of the selection range (or null; equals startLine for single lines)
 * `side`        — which side the line numbers refer to
 */
export interface ParsedDiffHash {
  cardId: string;
  /** DOM element ID of the first line in the range (for scrolling). */
  lineId: string | null;
  startLine: number | null;
  endLine: number | null;
  side: "new" | "del" | null;
}

/**
 * Parse a URL hash fragment into a file card ID and optional line range.
 *
 * Accepts hashes of the form:
 *   #diff-src_lib_foo_ts_L42        → single new-side line
 *   #diff-src_lib_foo_ts_DL42       → single del-side line
 *   #diff-src_lib_foo_ts_L42-L48    → new-side range
 *   #diff-src_lib_foo_ts_DL10-DL15  → del-side range
 *   #diff-src_lib_foo_ts            → file only (no line)
 *
 * Returns null if the hash doesn't match a diff anchor pattern.
 */
export function parseDiffLineHash(hash: string): ParsedDiffHash | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith("diff-")) return null;

  // Range anchor: diff-{cardId}_(DL|L){start}-(DL|L){end}
  const rangeMatch = raw.match(/^(diff-.+?)_(DL|L)(\d+)-(DL|L)(\d+)$/);
  if (rangeMatch) {
    const cardId = rangeMatch[1];
    const startPrefix = rangeMatch[2];
    const startLine = parseInt(rangeMatch[3], 10);
    const endLine = parseInt(rangeMatch[5], 10);
    const side: "new" | "del" = startPrefix === "DL" ? "del" : "new";
    const lineId = `${cardId}_${startPrefix}${startLine}`;
    return { cardId, lineId, startLine, endLine, side };
  }

  // Single line anchor: diff-{cardId}_(DL|L){n}
  const lineMatch = raw.match(/^(diff-.+?)_(DL|L)(\d+)$/);
  if (lineMatch) {
    const cardId = lineMatch[1];
    const prefix = lineMatch[2];
    const lineNum = parseInt(lineMatch[3], 10);
    const side: "new" | "del" = prefix === "DL" ? "del" : "new";
    return { cardId, lineId: raw, startLine: lineNum, endLine: lineNum, side };
  }

  // File-only anchor
  return {
    cardId: raw,
    lineId: null,
    startLine: null,
    endLine: null,
    side: null,
  };
}
