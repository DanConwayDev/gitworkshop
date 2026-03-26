/**
 * git-grasp-pool — diff processing utilities
 *
 * Pure functions that operate on CommitRangeData (from pool.getCommitRange)
 * to produce a unified diff string suitable for parse-diff / DiffView.
 *
 * Two-phase API:
 *   1. diffTrees(tipTree, baseTree) → FileChange[]
 *      Pure, synchronous. Walks both Tree structures and returns a flat list
 *      of every path that was added, deleted, or modified. Uses subtree-hash
 *      short-circuiting: if a directory hash is identical in both trees the
 *      entire subtree is skipped without recursion.
 *
 *   2. generateUnifiedDiff(changes, pool, signal) → Promise<string>
 *      Fetches only the blobs that changed (via pool.getBlob), detects binary
 *      files, and produces a concatenated unified diff string in standard git
 *      format (compatible with parse-diff and DiffView).
 */

import { createTwoFilesPatch } from "diff";
import type { Tree } from "@fiatjaf/git-natural-api";
import type { GitGraspPool } from "./pool";

// ---------------------------------------------------------------------------
// FileChange — the result of tree diffing
// ---------------------------------------------------------------------------

export type FileChangeStatus = "added" | "deleted" | "modified";

export interface FileChange {
  /** Repo-root-relative path, e.g. "src/lib/foo.ts" */
  path: string;
  status: FileChangeStatus;
  /**
   * Unix file mode string, e.g. "100644", "100755", "120000".
   * Currently always "100644" — the Tree type from git-natural-api does not
   * preserve per-file mode after loadTree(), so executable and symlink modes
   * are not distinguishable at this layer.
   */
  mode: string;
  /** Blob hash in the tip commit. null for deleted files. */
  tipHash: string | null;
  /** Blob hash in the base commit. null for added files. */
  baseHash: string | null;
}

// ---------------------------------------------------------------------------
// diffTrees — synchronous tree comparison
// ---------------------------------------------------------------------------

/**
 * Compare two fully-parsed Tree structures and return every file that
 * changed between them.
 *
 * Subtree short-circuit: when a directory's hash is the same in both trees
 * the entire subtree is skipped — no recursion needed. This makes the walk
 * O(changed files) in the common case rather than O(total files).
 *
 * @param tipTree  - Complete recursive tree at the tip commit
 * @param baseTree - Complete recursive tree at the base commit
 * @returns Flat list of changed files, sorted by path
 */
export function diffTrees(tipTree: Tree, baseTree: Tree): FileChange[] {
  const changes: FileChange[] = [];
  walkTrees(tipTree, baseTree, "", changes);
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

function walkTrees(
  tipTree: Tree,
  baseTree: Tree,
  prefix: string,
  out: FileChange[],
): void {
  // Index both sides by name for O(1) lookup in all four loops below
  const baseFiles = new Map(baseTree.files.map((f) => [f.name, f]));
  const baseDirs = new Map(baseTree.directories.map((d) => [d.name, d]));
  const tipFiles = new Map(tipTree.files.map((f) => [f.name, f]));
  const tipDirs = new Map(tipTree.directories.map((d) => [d.name, d]));

  // --- Files in tip ---
  for (const tipFile of tipTree.files) {
    const path = prefix + tipFile.name;
    const baseFile = baseFiles.get(tipFile.name);

    if (!baseFile) {
      // Added
      out.push({
        path,
        status: "added",
        mode: "100644",
        tipHash: tipFile.hash,
        baseHash: null,
      });
    } else if (tipFile.hash !== baseFile.hash) {
      // Modified
      out.push({
        path,
        status: "modified",
        mode: "100644",
        tipHash: tipFile.hash,
        baseHash: baseFile.hash,
      });
    }
    // Same hash → no change, skip
  }

  // --- Files only in base (deleted) — O(1) via tipFiles Map ---
  for (const baseFile of baseTree.files) {
    if (!tipFiles.has(baseFile.name)) {
      out.push({
        path: prefix + baseFile.name,
        status: "deleted",
        mode: "100644",
        tipHash: null,
        baseHash: baseFile.hash,
      });
    }
  }

  // --- Directories in tip ---
  for (const tipDir of tipTree.directories) {
    const dirPath = prefix + tipDir.name + "/";
    const baseDir = baseDirs.get(tipDir.name);

    if (!baseDir) {
      // Entire directory added — recurse with an empty base tree
      if (tipDir.content) {
        walkTrees(tipDir.content, EMPTY_TREE, dirPath, out);
      }
    } else if (tipDir.hash === baseDir.hash) {
      // Identical subtree hash → nothing changed inside, skip entirely
    } else {
      // Hash differs → recurse into both sides
      const tipContent = tipDir.content ?? EMPTY_TREE;
      const baseContent = baseDir.content ?? EMPTY_TREE;
      walkTrees(tipContent, baseContent, dirPath, out);
    }
  }

  // --- Directories only in base (deleted) — O(1) via tipDirs Map ---
  for (const baseDir of baseTree.directories) {
    if (!tipDirs.has(baseDir.name)) {
      const dirPath = prefix + baseDir.name + "/";
      if (baseDir.content) {
        walkTrees(EMPTY_TREE, baseDir.content, dirPath, out);
      }
    }
  }
}

/** Reusable empty tree sentinel — avoids allocating one per deleted dir */
const EMPTY_TREE: Tree = { directories: [], files: [] };

// ---------------------------------------------------------------------------
// generateUnifiedDiff — async blob fetch + diff generation
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "tiff",
  "avif",
  "svg", // treat as binary for diff purposes (XML noise)
  "pdf",
  "zip",
  "gz",
  "tar",
  "bz2",
  "xz",
  "7z",
  "rar",
  "wasm",
  "exe",
  "dll",
  "so",
  "dylib",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "mp3",
  "mp4",
  "wav",
  "ogg",
  "flac",
  "webm",
  "mov",
  "avi",
  "db",
  "sqlite",
  "sqlite3",
]);

function isBinaryByExtension(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXTENSIONS.has(ext);
}

function isBinaryByContent(data: Uint8Array): boolean {
  // Scan the first 8KB for null bytes — the same heuristic git uses
  const limit = Math.min(data.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (data[i] === 0) return true;
  }
  return false;
}

const utf8 = new TextDecoder("utf-8");

/**
 * Module-level diff string cache keyed by "tipHash:baseHash".
 *
 * Blob fetches are already cached by the pool, but the diff generation
 * (string allocation + createTwoFilesPatch CPU work) repeats on every mount
 * (e.g. tab switch). This cache makes repeated renders of the same diff
 * instant without re-running the generation loop.
 *
 * The cache is never evicted — diff strings are small relative to blob data
 * and the number of unique tip:base pairs a user visits in a session is low.
 */
const diffStringCache = new Map<string, string>();

/**
 * Fetch changed blobs and generate a concatenated unified diff string.
 *
 * For each FileChange:
 *   - Binary files (by extension or null-byte scan) emit a one-line
 *     "Binary files a/path and b/path differ" entry.
 *   - Text files are decoded as UTF-8 and diffed with 3 lines of context,
 *     matching standard `git diff` output.
 *
 * Blob fetches for all changed files run in parallel. The pool's cache
 * means blobs that were already fetched (e.g. during file browsing) are
 * returned instantly without a network request.
 *
 * The resulting diff string is cached in memory keyed by tipHash:baseHash so
 * that repeated calls (e.g. switching tabs) are instant.
 *
 * @param changes      - Output of diffTrees()
 * @param pool         - GitGraspPool instance (for getBlob)
 * @param signal       - AbortSignal for cancellation
 * @param fallbackUrls - Extra URLs to try after the pool's own URLs if a blob
 *   is not found there. Not tracked by the pool.
 * @param cacheKey     - Optional stable key for the diff string cache (e.g.
 *   "tipCommitHash:baseCommitHash"). When provided, a cached result is
 *   returned immediately on repeat calls without re-fetching blobs.
 * @returns Concatenated unified diff string, empty string if no changes
 */
export async function generateUnifiedDiff(
  changes: FileChange[],
  pool: GitGraspPool,
  signal: AbortSignal,
  fallbackUrls?: string[],
  cacheKey?: string,
): Promise<string> {
  if (changes.length === 0) return "";

  // Return cached diff string immediately if available
  if (cacheKey) {
    const cached = diffStringCache.get(cacheKey);
    if (cached !== undefined) return cached;
  }

  // Collect all unique blob hashes we need to fetch.
  // Skip hashes for files that are already known to be binary by extension —
  // those will be emitted as "Binary files … differ" without any blob content.
  const hashesToFetch = new Set<string>();
  for (const change of changes) {
    if (isBinaryByExtension(change.path)) continue;
    if (change.tipHash) hashesToFetch.add(change.tipHash);
    if (change.baseHash) hashesToFetch.add(change.baseHash);
  }

  // Fetch all blobs in parallel
  const blobResults = await Promise.all(
    Array.from(hashesToFetch).map(async (hash) => {
      const data = await pool.getBlob(hash, signal, fallbackUrls);
      return [hash, data] as const;
    }),
  );

  if (signal.aborted) return "";

  const blobs = new Map<string, Uint8Array>(
    blobResults.filter((r): r is [string, Uint8Array] => r[1] !== null),
  );

  // Generate diff hunks for each changed file
  const hunks: string[] = [];

  for (const change of changes) {
    if (signal.aborted) break;

    const aPath = change.status === "added" ? "/dev/null" : `a/${change.path}`;
    const bPath =
      change.status === "deleted" ? "/dev/null" : `b/${change.path}`;

    // Binary check by extension first (no blob fetch needed)
    if (isBinaryByExtension(change.path)) {
      hunks.push(binaryDiffLine(aPath, bPath));
      continue;
    }

    const tipData = change.tipHash ? blobs.get(change.tipHash) : null;
    const baseData = change.baseHash ? blobs.get(change.baseHash) : null;

    // Binary check by content
    if (
      (tipData && isBinaryByContent(tipData)) ||
      (baseData && isBinaryByContent(baseData))
    ) {
      hunks.push(binaryDiffLine(aPath, bPath));
      continue;
    }

    const tipText = tipData ? utf8.decode(tipData) : "";
    const baseText = baseData ? utf8.decode(baseData) : "";

    const patch = createTwoFilesPatch(aPath, bPath, baseText, tipText, "", "", {
      context: 3,
    });

    // createTwoFilesPatch returns just the separator + hunks when there are
    // no differences (e.g. a file whose hash changed but content is identical
    // after decoding — shouldn't happen but guard anyway).
    if (
      patch.trim() ===
      "==================================================================="
    ) {
      continue;
    }

    hunks.push(patch);
  }

  const diffString = hunks.join("\n");

  // Cache the result for instant repeat renders (e.g. tab switches)
  if (cacheKey && !signal.aborted) {
    diffStringCache.set(cacheKey, diffString);
  }

  return diffString;
}

function binaryDiffLine(aPath: string, bPath: string): string {
  return `Binary files ${aPath} and ${bPath} differ\n`;
}
