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
