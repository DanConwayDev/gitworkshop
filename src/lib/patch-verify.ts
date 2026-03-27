/**
 * patch-verify — blob hash verification for patch diffs.
 *
 * Extracts the abbreviated blob hashes from `index` lines in a unified diff
 * and verifies them against the actual content produced by applying the patch.
 *
 * This is a lightweight verification that catches silent apply failures
 * without requiring full git tree/commit reconstruction.
 */

import parseDiff from "parse-diff";
import { applyPatch } from "diff";
import { gitBlobHash } from "@/lib/git-objects";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single file's verification result when a mismatch is detected. */
export interface BlobMismatch {
  /** File path */
  path: string;
  /** Expected abbreviated hash from the index line */
  expected: string;
  /** Actual full hash we computed */
  actual: string;
}

/**
 * Verification result for patch blob hashes.
 *   - "verified"   — all verifiable files have matching blob hashes
 *   - "no-index"   — no index lines found to verify against (show nothing)
 *   - "warning"    — at least one blob hash mismatch detected
 */
export type VerificationResult =
  | { status: "verified"; fileCount: number }
  | { status: "no-index" }
  | { status: "warning"; mismatches: BlobMismatch[] };

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

function parseResultBlobHash(file: parseDiff.File): string | undefined {
  const idx = file.index;
  if (!idx || !Array.isArray(idx) || idx.length === 0) return undefined;

  const hashPart = idx[0];
  if (typeof hashPart !== "string") return undefined;

  const dotDot = hashPart.indexOf("..");
  if (dotDot === -1) return undefined;

  const result = hashPart.substring(dotDot + 2);
  if (/^0+$/.test(result)) return undefined;
  return result;
}

function getFilePath(file: parseDiff.File): string {
  if (file.to && file.to !== "/dev/null") return file.to;
  if (file.from && file.from !== "/dev/null") return file.from;
  return "unknown";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify blob hashes in a single patch diff string.
 *
 * For each new file in the diff that has an `index` line with a result hash:
 *   1. Apply the patch to an empty string
 *   2. Compute the git blob hash of the result
 *   3. Check if it matches the abbreviated hash from the index line
 *
 * Note: For modified files, we can only verify new-file patches (where the
 * source is /dev/null) because we don't have the original file content here.
 *
 * @param patchDiff - Raw unified diff string (from extractPatchDiff)
 * @returns Verification result with details
 */
export async function verifyPatchDiffBlobs(
  patchDiff: string,
): Promise<VerificationResult> {
  if (!patchDiff) return { status: "no-index" };

  try {
    const stripped = stripTrailer(patchDiff);
    const files = parseDiff(stripped);

    let verifiedCount = 0;
    const mismatches: BlobMismatch[] = [];

    for (const file of files) {
      const resultHash = parseResultBlobHash(file);
      if (!resultHash) continue;

      // We can only verify new files (source is /dev/null) because we don't
      // have the original content for modified files in this context.
      if (!file.new) continue;

      // Apply the patch to empty content
      const diffString = reconstructPerFileDiff(file);
      const result = applyPatch("", diffString);

      if (result === false) {
        mismatches.push({
          path: getFilePath(file),
          expected: resultHash,
          actual: "(apply failed)",
        });
        continue;
      }

      // Compute blob hash and compare
      const contentBytes = new TextEncoder().encode(result);
      const hashHex = await gitBlobHash(contentBytes);

      if (!hashHex.startsWith(resultHash)) {
        mismatches.push({
          path: getFilePath(file),
          expected: resultHash,
          actual: hashHex.slice(0, resultHash.length),
        });
      } else {
        verifiedCount++;
      }
    }

    if (mismatches.length > 0) return { status: "warning", mismatches };
    if (verifiedCount > 0)
      return { status: "verified", fileCount: verifiedCount };
    return { status: "no-index" };
  } catch {
    return { status: "no-index" };
  }
}
