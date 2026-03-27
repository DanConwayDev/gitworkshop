/**
 * patch-verify — blob hash verification for patch diffs.
 *
 * Extracts the abbreviated blob hashes from `index` lines in a unified diff
 * and verifies them against the actual content produced by applying the patch.
 *
 * This is a lightweight verification that catches silent apply failures
 * without requiring full git tree/commit reconstruction.
 *
 * Returns one of:
 *   - "verified"   — all files with index lines have matching blob hashes
 *   - "unverified" — no index lines found to verify against
 *   - "warning"    — at least one blob hash mismatch detected
 */

import parseDiff from "parse-diff";
import { applyPatch } from "diff";
import { gitBlobHash } from "@/lib/git-objects";

/**
 * Verification status for patch blob hashes.
 *   - "pending"    — verification hasn't run yet
 *   - "verified"   — all verifiable files have matching blob hashes
 *   - "unverified" — no index lines found to verify against
 *   - "warning"    — at least one blob hash mismatch detected
 */
export type VerificationStatus =
  | "pending"
  | "verified"
  | "unverified"
  | "warning";

// ---------------------------------------------------------------------------
// Trailer stripping (shared with patch-diff-merge.ts)
// ---------------------------------------------------------------------------

function stripTrailer(diffStr: string): string {
  return diffStr.replace(/\n-- \n[\s\S]*$/, "").replace(/\n--\n[\s\S]*$/, "");
}

// ---------------------------------------------------------------------------
// Per-file diff reconstruction (minimal version for apply)
// ---------------------------------------------------------------------------

function reconstructPerFileDiff(file: parseDiff.File): string {
  const oldName =
    file.from === "/dev/null" ? "/dev/null" : `a/${file.from ?? "unknown"}`;
  const newName =
    file.to === "/dev/null" ? "/dev/null" : `b/${file.to ?? "unknown"}`;

  let result = `--- ${oldName}\n+++ ${newName}\n`;

  for (const chunk of file.chunks) {
    result += chunk.content + "\n";
    for (const change of chunk.changes) {
      result += change.content + "\n";
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Index line parsing
// ---------------------------------------------------------------------------

interface IndexInfo {
  /** Abbreviated hash of the source (before) blob */
  sourceHash: string | undefined;
  /** Abbreviated hash of the result (after) blob */
  resultHash: string | undefined;
}

function parseIndexLine(file: parseDiff.File): IndexInfo {
  const idx = file.index;
  if (!idx || !Array.isArray(idx) || idx.length === 0) {
    return { sourceHash: undefined, resultHash: undefined };
  }

  const hashPart = idx[0];
  if (typeof hashPart !== "string") {
    return { sourceHash: undefined, resultHash: undefined };
  }

  const dotDot = hashPart.indexOf("..");
  if (dotDot === -1) {
    return { sourceHash: undefined, resultHash: undefined };
  }

  const source = hashPart.substring(0, dotDot);
  const result = hashPart.substring(dotDot + 2);

  return {
    sourceHash: /^0+$/.test(source) ? undefined : source,
    resultHash: /^0+$/.test(result) ? undefined : result,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify blob hashes in a single patch diff string.
 *
 * For each file in the diff that has an `index` line with a result hash:
 *   1. Apply the patch to an empty string (for new files) or reconstruct
 *      the "before" content from context + removed lines
 *   2. Compute the git blob hash of the result
 *   3. Check if it matches the abbreviated hash from the index line
 *
 * Note: For modified files, we can only verify new-file patches (where the
 * source is /dev/null) because we don't have the original file content here.
 * For modified files, we skip verification (return "unverified" for those).
 *
 * @param patchDiff - Raw unified diff string (from extractPatchDiff)
 * @returns Verification status
 */
export async function verifyPatchDiffBlobs(
  patchDiff: string,
): Promise<VerificationStatus> {
  if (!patchDiff) return "unverified";

  try {
    const stripped = stripTrailer(patchDiff);
    const files = parseDiff(stripped);

    let hasVerifiable = false;
    let hasMismatch = false;

    for (const file of files) {
      const { resultHash } = parseIndexLine(file);
      if (!resultHash) continue;

      // We can only verify new files (source is /dev/null) because we don't
      // have the original content for modified files in this context.
      if (!file.new) continue;

      hasVerifiable = true;

      // Apply the patch to empty content
      const diffString = reconstructPerFileDiff(file);
      const result = applyPatch("", diffString);

      if (result === false) {
        hasMismatch = true;
        continue;
      }

      // Compute blob hash and compare
      const contentBytes = new TextEncoder().encode(result);
      const hashHex = await gitBlobHash(contentBytes);

      if (!hashHex.startsWith(resultHash)) {
        hasMismatch = true;
      }
    }

    if (hasMismatch) return "warning";
    if (hasVerifiable) return "verified";
    return "unverified";
  } catch {
    return "unverified";
  }
}
