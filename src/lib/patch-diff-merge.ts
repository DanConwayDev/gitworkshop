/**
 * patch-diff-merge — apply a chain of NIP-34 patches to produce a combined diff.
 *
 * Given an ordered chain of Patch casts (oldest first), this module:
 *   1. Extracts per-file diffs from each patch using parse-diff
 *   2. Groups changes by file path across the whole chain
 *   3. For each file, fetches the original content from the git server
 *      (via GitGraspPool) and applies each patch's hunks sequentially
 *      using the `diff` package's applyPatch()
 *   4. Generates a combined unified diff (original → final) for each file
 *   5. Concatenates into a single diff string for DiffView
 *
 * Blob-hash spot-checking: when the last patch touching a file has an
 * `index` line with an abbreviated result hash, we verify our applied
 * content matches. This catches silent apply failures.
 *
 * The module also exports FileChange-compatible metadata so the file-tree
 * sidebar can render immediately (Phase 1) before the full diff is ready
 * (Phase 2).
 */

import parseDiff from "parse-diff";
import { applyPatch, createTwoFilesPatch } from "diff";
import { extractPatchDiff } from "@/lib/nip34";
import { gitBlobHash } from "@/lib/git-objects";
import type { Patch } from "@/casts/Patch";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
import type { FileChange, FileChangeStatus } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A per-file entry from a single patch in the chain. */
interface PatchFileEntry {
  /** parse-diff file object */
  file: parseDiff.File;
  /** The raw per-file diff string (reconstructed from parse-diff) */
  diffString: string;
  /** Patch index in the chain (for ordering) */
  chainIndex: number;
  /** Abbreviated result blob hash from the index line, if available */
  resultBlobHashPrefix: string | undefined;
}

/** Result of merging all patches for a single file. */
export interface MergedFileResult {
  path: string;
  status: FileChangeStatus;
  /** Original file content (empty string for new files) */
  originalContent: string;
  /** Final file content after all patches applied */
  finalContent: string;
  /** The combined unified diff string for this file */
  diff: string;
  /** True if blob hash verification passed (or was not available) */
  hashVerified: boolean;
  /** Non-null if patch application failed for this file */
  error: string | null;
}

/** Full result of merging a patch chain. */
export interface PatchChainDiffResult {
  /** Per-file results, sorted by path */
  files: MergedFileResult[];
  /** FileChange[] for the file-tree sidebar (available before full diff) */
  fileChanges: FileChange[];
  /** Concatenated unified diff string for DiffView */
  combinedDiff: string;
  /** Number of files that failed to apply */
  failedCount: number;
}

// ---------------------------------------------------------------------------
// Trailer stripping
// ---------------------------------------------------------------------------

/**
 * Strip the `-- \n<version>` or `--\n<version>` trailer that
 * `git format-patch` appends. parsePatch() from the `diff` package throws
 * on this; parse-diff tolerates it but we strip anyway for clean diffs.
 */
function stripTrailer(diffStr: string): string {
  return diffStr.replace(/\n-- \n[\s\S]*$/, "").replace(/\n--\n[\s\S]*$/, "");
}

// ---------------------------------------------------------------------------
// Per-file diff reconstruction from parse-diff
// ---------------------------------------------------------------------------

/**
 * Reconstruct a per-file unified diff string from a parse-diff File object.
 * This produces a string that `diff.applyPatch()` can consume.
 */
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

/**
 * Extract the abbreviated result blob hash from a parse-diff index field.
 * The index field looks like ["247030b..95aa2b3", "100644"].
 * Returns the hash after ".." (the result side), or undefined.
 */
function extractResultBlobHash(file: parseDiff.File): string | undefined {
  const idx = file.index;
  if (!idx || !Array.isArray(idx) || idx.length === 0) return undefined;
  const hashPart = idx[0];
  if (typeof hashPart !== "string") return undefined;
  const dotDot = hashPart.indexOf("..");
  if (dotDot === -1) return undefined;
  const result = hashPart.substring(dotDot + 2);
  // Skip the all-zeros hash (new/deleted files)
  if (/^0+$/.test(result)) return undefined;
  return result;
}

// ---------------------------------------------------------------------------
// File path extraction from parse-diff
// ---------------------------------------------------------------------------

/**
 * Get the canonical file path from a parse-diff File object.
 * For renames, returns the destination path.
 */
function getFilePath(file: parseDiff.File): string {
  if (file.to && file.to !== "/dev/null") return file.to;
  if (file.from && file.from !== "/dev/null") return file.from;
  return "unknown";
}

// ---------------------------------------------------------------------------
// Core: merge a patch chain into a combined diff
// ---------------------------------------------------------------------------

/**
 * Parse all patches in a chain and group per-file entries by path.
 *
 * Returns a Map from file path to ordered PatchFileEntry[].
 * Also returns the set of file paths that are renames (old path → new path).
 */
function parsePatchChain(chain: Patch[]): {
  fileEntries: Map<string, PatchFileEntry[]>;
  renames: Map<string, string>;
} {
  const fileEntries = new Map<string, PatchFileEntry[]>();
  const renames = new Map<string, string>();

  for (let i = 0; i < chain.length; i++) {
    const patch = chain[i];
    const rawDiff = extractPatchDiff(patch.content);
    if (!rawDiff) continue;

    const stripped = stripTrailer(rawDiff);
    const files = parseDiff(stripped);

    for (const file of files) {
      // Skip binary files — we can't apply text diffs to them
      if (file.chunks.length === 0 && !file.new && !file.deleted) {
        // Could be a rename with no content change, or binary
        if (
          file.from &&
          file.to &&
          file.from !== file.to &&
          file.from !== "/dev/null" &&
          file.to !== "/dev/null"
        ) {
          renames.set(file.from, file.to);
        }
        continue;
      }

      const path = getFilePath(file);
      const entry: PatchFileEntry = {
        file,
        diffString: reconstructPerFileDiff(file),
        chainIndex: i,
        resultBlobHashPrefix: extractResultBlobHash(file),
      };

      const existing = fileEntries.get(path) ?? [];
      existing.push(entry);
      fileEntries.set(path, existing);

      // Track renames that also have content changes
      if (
        file.from &&
        file.to &&
        file.from !== file.to &&
        file.from !== "/dev/null" &&
        file.to !== "/dev/null"
      ) {
        renames.set(file.from, file.to);
      }
    }
  }

  return { fileEntries, renames };
}

/**
 * Compute the quick file-change list from a patch chain.
 * This is synchronous and doesn't require fetching any blobs — suitable
 * for rendering the file-tree sidebar immediately.
 */
export function computePatchFileChanges(chain: Patch[]): FileChange[] {
  const { fileEntries, renames } = parsePatchChain(chain);
  const changes: FileChange[] = [];
  const seen = new Set<string>();

  for (const [path, entries] of fileEntries) {
    if (seen.has(path)) continue;
    seen.add(path);

    // Use the first entry to determine initial status, last for final
    const firstEntry = entries[0];
    const lastEntry = entries[entries.length - 1];

    let status: FileChangeStatus;
    if (firstEntry.file.new) {
      // If the last patch deletes it, the file is effectively unchanged
      if (lastEntry.file.deleted) continue;
      status = "added";
    } else if (lastEntry.file.deleted) {
      status = "deleted";
    } else {
      status = "modified";
    }

    changes.push({
      path,
      status,
      mode: "100644",
      tipHash: null,
      baseHash: null,
    });
  }

  // Add pure renames (no content change) as modified
  for (const [oldPath, newPath] of renames) {
    if (!seen.has(newPath) && !seen.has(oldPath)) {
      seen.add(newPath);
      changes.push({
        path: newPath,
        status: "modified",
        mode: "100644",
        tipHash: null,
        baseHash: null,
      });
    }
  }

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Merge a full patch chain into a combined diff.
 *
 * For each file touched by any patch in the chain:
 *   1. Fetch the original content from the git server (if not a new file)
 *   2. Apply each patch's hunks sequentially
 *   3. Generate a combined diff (original → final)
 *
 * @param chain         Ordered patches (oldest first) from the latest revision
 * @param pool          GitGraspPool for fetching original file content
 * @param baseCommitId  The parent-commit of the first patch (base to fetch from)
 * @param signal        AbortSignal for cancellation
 * @param fallbackUrls  Extra clone URLs to try
 * @returns Combined diff result
 */
export async function mergePatchChainDiff(
  chain: Patch[],
  pool: GitGraspPool,
  baseCommitId: string | undefined,
  signal: AbortSignal,
  fallbackUrls?: string[],
): Promise<PatchChainDiffResult> {
  if (chain.length === 0) {
    return { files: [], fileChanges: [], combinedDiff: "", failedCount: 0 };
  }

  const { fileEntries } = parsePatchChain(chain);
  const results: MergedFileResult[] = [];
  let failedCount = 0;

  // Process all files in parallel
  const filePromises = Array.from(fileEntries.entries()).map(
    async ([path, entries]) => {
      if (signal.aborted) return null;

      const firstEntry = entries[0];
      const lastEntry = entries[entries.length - 1];
      const isNewFile = firstEntry.file.new === true;
      const isDeleted = lastEntry.file.deleted === true;

      // Determine overall status
      let status: FileChangeStatus;
      if (isNewFile && isDeleted) {
        // Created then deleted — skip
        return null;
      } else if (isNewFile) {
        status = "added";
      } else if (isDeleted) {
        status = "deleted";
      } else {
        status = "modified";
      }

      // Fetch original content for modified/deleted files
      let originalContent = "";
      if (!isNewFile && baseCommitId && pool) {
        try {
          const obj = await pool.getObjectByPath(
            baseCommitId,
            path,
            signal,
            fallbackUrls,
          );
          if (obj?.data) {
            originalContent = new TextDecoder().decode(obj.data);
          }
        } catch {
          // If we can't fetch the original, try applying anyway —
          // the patch might have enough context to reconstruct
        }
      }

      // Apply patches sequentially
      let content = originalContent;
      let error: string | null = null;

      for (const entry of entries) {
        if (signal.aborted) return null;

        const result = applyPatch(content, entry.diffString);
        if (result === false) {
          // Try with fuzz factor
          const fuzzyResult = applyPatch(content, entry.diffString, {
            fuzzFactor: 3,
          });
          if (fuzzyResult === false) {
            error = `Patch ${entry.chainIndex + 1} failed to apply to ${path}`;
            failedCount++;
            break;
          }
          content = fuzzyResult;
        } else {
          content = result;
        }
      }

      // If apply failed, fall back to showing the raw diff from the last patch
      let diff: string;
      if (error) {
        // Concatenate all raw diffs for this file as fallback
        diff = entries.map((e) => e.diffString).join("\n");
      } else {
        // Generate clean combined diff
        const aPath = isNewFile ? "/dev/null" : `a/${path}`;
        const bPath = isDeleted ? "/dev/null" : `b/${path}`;
        const finalContent = isDeleted ? "" : content;

        diff = createTwoFilesPatch(
          aPath,
          bPath,
          originalContent,
          finalContent,
          "",
          "",
          { context: 3 },
        );

        // Skip files with no actual changes (can happen if patches cancel out)
        if (originalContent === finalContent && !isNewFile && !isDeleted) {
          return null;
        }
      }

      // Blob hash spot-check: verify the last patch's expected result hash
      let hashVerified = true;
      if (!error) {
        const expectedPrefix = lastEntry.resultBlobHashPrefix;
        if (expectedPrefix) {
          try {
            const contentBytes = new TextEncoder().encode(content);
            const hashHex = await gitBlobHash(contentBytes);
            if (!hashHex.startsWith(expectedPrefix)) {
              hashVerified = false;
              // Don't treat as error — the diff is still useful, just unverified
            }
          } catch {
            // SubtleCrypto not available — skip verification
          }
        }
      }

      return {
        path,
        status,
        originalContent,
        finalContent: content,
        diff,
        hashVerified,
        error,
      } satisfies MergedFileResult;
    },
  );

  const settled = await Promise.all(filePromises);
  for (const r of settled) {
    if (r) results.push(r);
  }

  if (signal.aborted) {
    return { files: [], fileChanges: [], combinedDiff: "", failedCount: 0 };
  }

  // Sort by path
  results.sort((a, b) => a.path.localeCompare(b.path));

  // Build FileChange[] for sidebar
  const fileChanges: FileChange[] = results.map((r) => ({
    path: r.path,
    status: r.status,
    mode: "100644",
    tipHash: null,
    baseHash: null,
  }));

  // Concatenate all diffs
  const combinedDiff = results
    .map((r) => r.diff)
    .filter(Boolean)
    .join("\n");

  return { files: results, fileChanges, combinedDiff, failedCount };
}

/**
 * Convenience: merge a patch chain and return just the combined diff string.
 * Suitable for simple use cases that don't need per-file results.
 */
export async function generatePatchChainCombinedDiff(
  chain: Patch[],
  pool: GitGraspPool,
  baseCommitId: string | undefined,
  signal: AbortSignal,
  fallbackUrls?: string[],
): Promise<string> {
  const result = await mergePatchChainDiff(
    chain,
    pool,
    baseCommitId,
    signal,
    fallbackUrls,
  );
  return result.combinedDiff;
}
