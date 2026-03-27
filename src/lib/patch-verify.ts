/**
 * patch-verify — verification for patch-sourced commits.
 *
 * Two levels of verification:
 *
 * 1. **Blob hash spot-check** (verifyPatchDiffBlobs): Lightweight check that
 *    verifies new-file blob hashes from the diff's `index` lines. Doesn't
 *    need a git server.
 *
 * 2. **Full commit hash verification** (verifyPatchCommitHash): Fetches the
 *    parent commit's tree from the git server, applies the patch to produce
 *    new blob hashes, rebuilds the tree bottom-up, constructs the commit
 *    object, and compares the computed hash to the claimed commit ID.
 */

import parseDiff from "parse-diff";
import { applyPatch } from "diff";
import {
  gitBlobHash,
  gitBlobHashFromString,
  gitTreeHash,
  gitCommitHash,
  type TreeEntry,
  type CommitData,
  type CommitPerson,
} from "@/lib/git-objects";
import { extractPatchDiff } from "@/lib/nip34";
import { formatTimezone, extractGpgSignature } from "@/lib/patch-commits";
import type { Patch } from "@/casts/Patch";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
import type { Tree } from "@fiatjaf/git-natural-api";

// ---------------------------------------------------------------------------
// Blob verification types (lightweight, no git server needed)
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

export type VerificationResult =
  | { status: "verified"; fileCount: number }
  | { status: "no-index" }
  | { status: "warning"; mismatches: BlobMismatch[] };

// ---------------------------------------------------------------------------
// Commit hash verification types
// ---------------------------------------------------------------------------

export type CommitHashResult =
  | { status: "match"; computed: string; claimed: string }
  | { status: "mismatch"; computed: string; claimed: string }
  | { status: "unavailable"; reason: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripTrailer(diffStr: string): string {
  return diffStr.replace(/\n-- \n[\s\S]*$/, "").replace(/\n--\n[\s\S]*$/, "");
}

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
// Blob verification (lightweight, no git server)
// ---------------------------------------------------------------------------

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
      if (!file.new) continue;

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

// ---------------------------------------------------------------------------
// Full commit hash verification
// ---------------------------------------------------------------------------

/**
 * Parse a person tag from a patch event for commit serialization.
 */
function parsePersonTag(
  patch: Patch,
  tagName: string,
): CommitPerson | undefined {
  const tag = patch.event.tags.find(([t]) => t === tagName);
  if (!tag) return undefined;
  const [, name, email, tsStr, tzStr] = tag;
  if (!name || !tsStr) return undefined;
  const timestamp = parseInt(tsStr, 10);
  if (isNaN(timestamp)) return undefined;
  return {
    name,
    email: email ?? "",
    timestamp,
    timezone: formatTimezone(tzStr),
  };
}

/**
 * Rebuild a tree hash bottom-up after replacing blob hashes for changed files.
 *
 * Takes the original tree and a map of path → new blob hash for changed files.
 * Returns the new root tree hash.
 */
async function rebuildTreeHash(
  tree: Tree,
  changedBlobs: Map<string, string>,
  deletedPaths: Set<string>,
  prefix: string = "",
): Promise<string> {
  const entries: TreeEntry[] = [];

  for (const file of tree.files) {
    const fullPath = prefix + file.name;
    if (deletedPaths.has(fullPath)) continue;
    const hash = changedBlobs.get(fullPath) ?? file.hash;
    entries.push({ mode: "100644", name: file.name, hash });
  }

  // Add new files that are in this directory but weren't in the original tree
  for (const [path, hash] of changedBlobs) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    // Only files directly in this directory (no "/" in relative path)
    if (!relative.includes("/")) {
      // Check if already added from the original tree
      if (!entries.some((e) => e.name === relative)) {
        entries.push({ mode: "100644", name: relative, hash });
      }
    }
  }

  for (const dir of tree.directories) {
    const dirPrefix = prefix + dir.name + "/";

    // Check if any files in this directory were changed/added/deleted
    if (dir.content) {
      const subHash = await rebuildTreeHash(
        dir.content,
        changedBlobs,
        deletedPaths,
        dirPrefix,
      );
      entries.push({ mode: "40000", name: dir.name, hash: subHash });
    } else {
      // No content loaded — use original hash (no changes in this subtree)
      entries.push({ mode: "40000", name: dir.name, hash: dir.hash });
    }
  }

  // Add new directories that weren't in the original tree
  // Collect all new directory names at this level
  const existingDirNames = new Set(tree.directories.map((d) => d.name));
  const newDirFiles = new Map<string, Map<string, string>>();

  for (const [path, hash] of changedBlobs) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    const slashIdx = relative.indexOf("/");
    if (slashIdx === -1) continue; // file, not dir
    const dirName = relative.slice(0, slashIdx);
    if (existingDirNames.has(dirName)) continue;
    if (!newDirFiles.has(dirName)) newDirFiles.set(dirName, new Map());
    newDirFiles.get(dirName)!.set(relative.slice(slashIdx + 1), hash);
  }

  for (const [dirName, files] of newDirFiles) {
    const subHash = await buildNewDirTreeHash(files);
    entries.push({ mode: "40000", name: dirName, hash: subHash });
  }

  return gitTreeHash(entries);
}

/**
 * Build a tree hash for a completely new directory (not in the original tree).
 * Takes a map of relative-path → blob hash.
 */
async function buildNewDirTreeHash(
  files: Map<string, string>,
): Promise<string> {
  const entries: TreeEntry[] = [];
  const subdirs = new Map<string, Map<string, string>>();

  for (const [path, hash] of files) {
    const slashIdx = path.indexOf("/");
    if (slashIdx === -1) {
      entries.push({ mode: "100644", name: path, hash });
    } else {
      const dirName = path.slice(0, slashIdx);
      const rest = path.slice(slashIdx + 1);
      if (!subdirs.has(dirName)) subdirs.set(dirName, new Map());
      subdirs.get(dirName)!.set(rest, hash);
    }
  }

  for (const [dirName, subFiles] of subdirs) {
    const subHash = await buildNewDirTreeHash(subFiles);
    entries.push({ mode: "40000", name: dirName, hash: subHash });
  }

  return gitTreeHash(entries);
}

/**
 * Verify a patch's claimed commit hash by reconstructing the commit from
 * the parent tree + applied diff + commit metadata.
 *
 * Steps:
 *   1. Fetch the parent commit to get its tree hash
 *   2. Fetch the parent tree (recursive) to get all file hashes
 *   3. Parse the patch diff to find changed files
 *   4. For each changed file: fetch original content, apply patch, compute
 *      new blob hash
 *   5. Rebuild the tree bottom-up with new blob hashes
 *   6. Construct the commit object with tree hash + metadata from patch tags
 *   7. Hash it and compare to the claimed commit ID
 *
 * @param patch - The patch event to verify
 * @param pool - GitGraspPool for fetching tree/blob data
 * @param signal - AbortSignal for cancellation
 * @param fallbackUrls - Extra clone URLs to try
 */
export async function verifyPatchCommitHash(
  patch: Patch,
  pool: GitGraspPool,
  signal: AbortSignal,
  fallbackUrls?: string[],
): Promise<CommitHashResult> {
  const claimedHash = patch.commitId;
  if (!claimedHash) {
    return { status: "unavailable", reason: "No commit ID tag on this patch" };
  }

  const parentCommitId = patch.parentCommitId;
  if (!parentCommitId) {
    return {
      status: "unavailable",
      reason: "No parent-commit tag — cannot reconstruct tree",
    };
  }

  // Step 1: Fetch parent commit to get its tree hash
  const parentCommit = await pool.getSingleCommit(
    parentCommitId,
    signal,
    fallbackUrls,
  );
  if (!parentCommit) {
    return {
      status: "unavailable",
      reason: "Could not fetch parent commit from git server",
    };
  }

  // Step 2: Fetch the parent tree (recursive)
  const parentTree = await pool.getTree(
    parentCommitId,
    0,
    signal,
    fallbackUrls,
  );
  if (!parentTree) {
    return {
      status: "unavailable",
      reason: "Could not fetch parent tree from git server",
    };
  }

  // Step 3: Parse the patch diff
  const patchDiff = extractPatchDiff(patch.content);
  if (!patchDiff) {
    return { status: "unavailable", reason: "No diff content in patch" };
  }

  const stripped = stripTrailer(patchDiff);
  const files = parseDiff(stripped);

  // Step 4: For each changed file, compute new blob hash
  const changedBlobs = new Map<string, string>();
  const deletedPaths = new Set<string>();

  for (const file of files) {
    if (signal.aborted) {
      return { status: "unavailable", reason: "Aborted" };
    }

    const filePath = getFilePath(file);

    if (file.deleted) {
      deletedPaths.add(filePath);
      continue;
    }

    // Get original content
    let originalContent = "";
    if (!file.new && file.from && file.from !== "/dev/null") {
      try {
        const obj = await pool.getObjectByPath(
          parentCommitId,
          file.from,
          signal,
          fallbackUrls,
        );
        if (obj?.data) {
          originalContent = new TextDecoder().decode(obj.data);
        }
      } catch {
        return {
          status: "unavailable",
          reason: `Could not fetch original content for ${file.from}`,
        };
      }
    }

    // Apply the patch
    const diffString = reconstructPerFileDiff(file);
    let result = applyPatch(originalContent, diffString);
    if (result === false) {
      result = applyPatch(originalContent, diffString, { fuzzFactor: 3 });
      if (result === false) {
        return {
          status: "unavailable",
          reason: `Patch failed to apply for ${filePath}`,
        };
      }
    }

    // Compute new blob hash
    const newHash = await gitBlobHashFromString(result);
    changedBlobs.set(filePath, newHash);
  }

  // Step 5: Rebuild tree hash
  const newTreeHash = await rebuildTreeHash(
    parentTree,
    changedBlobs,
    deletedPaths,
  );

  // Step 6: Build commit object
  const author = parsePersonTag(patch, "author");
  const committer = parsePersonTag(patch, "committer");

  if (!author) {
    return {
      status: "unavailable",
      reason: "No author tag — cannot reconstruct commit object",
    };
  }

  // Extract commit message from patch
  const subject = patch.subject;
  const body = patch.body;
  const message = body ? `${subject}\n\n${body}` : subject;

  const gpgSig = extractGpgSignature(patch);

  const commitData: CommitData = {
    treeHash: newTreeHash,
    parentHashes: [parentCommitId],
    author,
    committer: committer ?? author,
    message,
    gpgSignature: gpgSig,
  };

  // Step 7: Hash and compare
  const computedHash = await gitCommitHash(commitData);

  if (computedHash === claimedHash) {
    return { status: "match", computed: computedHash, claimed: claimedHash };
  }

  return { status: "mismatch", computed: computedHash, claimed: claimedHash };
}
