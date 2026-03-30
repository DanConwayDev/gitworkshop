/**
 * patch-merge — build git objects from a NIP-34 patch chain for merging.
 *
 * This module parallels patch-verify.ts but instead of discarding the
 * serialized bytes after hash verification, it COLLECTS all intermediate
 * git objects (blobs, trees, commits) as PackableObjects ready to be packed
 * into a packfile and pushed to a Grasp server.
 *
 * The pipeline:
 *   1. Walk the patch chain from first to last
 *   2. For each patch: apply the diff, rebuild the tree, serialize the commit
 *   3. Collect every blob, tree, and commit object produced
 *   4. Return the full set of objects + the final tree hash + tip commit hash
 *
 * A separate function creates the merge commit object (two parents: default
 * branch HEAD + patch chain tip).
 */

import parseDiff from "parse-diff";
import { applyPatch } from "diff";
import {
  gitObjectBytes,
  sha1hex,
  serializeTreeContent,
  type TreeEntry,
  type CommitData,
  type CommitPerson,
} from "@/lib/git-objects";
import { packBlob, packCommit, type PackableObject } from "@/lib/git-packfile";
import { extractPatchDiff } from "@/lib/nip34";
import { normalizeDiffPrefix } from "@/lib/patch-verify";
import { formatTimezone, extractGpgSignature } from "@/lib/patch-commits";
import type { Patch } from "@/casts/Patch";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
import type { Tree } from "@fiatjaf/git-natural-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A file that failed to apply cleanly. */
export interface MergeConflict {
  /** File path that failed */
  path: string;
  /** Human-readable reason */
  reason: string;
  /** Which patch in the chain (0-indexed) caused the failure */
  patchIndex: number;
}

/** Result of building the patch chain objects. */
export interface PatchChainBuildResult {
  /** All git objects needed for the packfile (blobs + trees + commits) */
  objects: PackableObject[];
  /** The tree hash of the final state after all patches applied */
  finalTreeHash: string;
  /** The commit hash of the last patch in the chain (merge commit parent) */
  tipCommitHash: string;
  /** Whether all claimed commit hashes matched the computed ones */
  allHashesVerified: boolean;
  /** Per-patch hash verification: patch event ID -> match/mismatch */
  hashResults: Map<
    string,
    { computed: string; claimed: string; match: boolean }
  >;
}

/** Error result when the chain cannot be applied. */
export interface PatchChainBuildError {
  /** What went wrong */
  reason: string;
  /** Specific file conflicts, if any */
  conflicts: MergeConflict[];
}

// ---------------------------------------------------------------------------
// Helpers (shared with patch-verify.ts — duplicated to avoid coupling)
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

function getFilePath(file: parseDiff.File): string {
  if (file.to && file.to !== "/dev/null") return file.to;
  if (file.from && file.from !== "/dev/null") return file.from;
  return "unknown";
}

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

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Tree rebuilding with object collection
// ---------------------------------------------------------------------------

/**
 * Rebuild a tree recursively, collecting all tree PackableObjects along the way.
 * Returns the root tree hash and appends all tree objects to `collector`.
 */
async function rebuildTreeCollecting(
  tree: Tree,
  changedBlobs: Map<string, string>,
  deletedPaths: Set<string>,
  collector: PackableObject[],
  prefix: string = "",
): Promise<string> {
  const entries: TreeEntry[] = [];

  // Existing files (possibly with updated hashes)
  for (const file of tree.files) {
    const fullPath = prefix + file.name;
    if (deletedPaths.has(fullPath)) continue;
    const hash = changedBlobs.get(fullPath) ?? file.hash;
    entries.push({ mode: "100644", name: file.name, hash });
  }

  // New files at this level
  for (const [path, hash] of changedBlobs) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    if (!relative.includes("/")) {
      if (!entries.some((e) => e.name === relative)) {
        entries.push({ mode: "100644", name: relative, hash });
      }
    }
  }

  // Existing subdirectories
  for (const dir of tree.directories) {
    const dirPrefix = prefix + dir.name + "/";
    // Only recurse if this directory contains a changed or deleted path.
    // If nothing changed under it, use the original hash to preserve the
    // exact subtree (including non-standard file modes like 100755).
    const hasChanges = [...changedBlobs.keys(), ...deletedPaths].some((p) =>
      p.startsWith(dirPrefix),
    );
    if (dir.content && hasChanges) {
      const subHash = await rebuildTreeCollecting(
        dir.content,
        changedBlobs,
        deletedPaths,
        collector,
        dirPrefix,
      );
      entries.push({ mode: "40000", name: dir.name, hash: subHash });
    } else {
      entries.push({ mode: "40000", name: dir.name, hash: dir.hash });
    }
  }

  // New subdirectories
  const existingDirNames = new Set(tree.directories.map((d) => d.name));
  const newDirFiles = new Map<string, Map<string, string>>();

  for (const [path, hash] of changedBlobs) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    const slashIdx = relative.indexOf("/");
    if (slashIdx === -1) continue;
    const dirName = relative.slice(0, slashIdx);
    if (existingDirNames.has(dirName)) continue;
    if (!newDirFiles.has(dirName)) newDirFiles.set(dirName, new Map());
    newDirFiles.get(dirName)!.set(relative.slice(slashIdx + 1), hash);
  }

  for (const [dirName, files] of newDirFiles) {
    const subHash = await buildNewDirTreeCollecting(files, collector);
    entries.push({ mode: "40000", name: dirName, hash: subHash });
  }

  // Serialize this tree and collect it
  const content = serializeTreeContent(entries);
  const fullObject = gitObjectBytes("tree", content);
  const hash = await sha1hex(fullObject);
  collector.push({ type: "tree", data: content, hash });

  return hash;
}

/**
 * Build a tree for a brand-new directory, collecting tree objects.
 */
async function buildNewDirTreeCollecting(
  files: Map<string, string>,
  collector: PackableObject[],
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
    const subHash = await buildNewDirTreeCollecting(subFiles, collector);
    entries.push({ mode: "40000", name: dirName, hash: subHash });
  }

  const content = serializeTreeContent(entries);
  const fullObject = gitObjectBytes("tree", content);
  const hash = await sha1hex(fullObject);
  collector.push({ type: "tree", data: content, hash });

  return hash;
}

/**
 * Mutate a Tree in-place to reflect changed/added/deleted blobs.
 * Returns a new Tree (shallow copy) with updated hashes.
 * (Mirrors patch-verify.ts applyBlobChangesToTree)
 */
function applyBlobChangesToTree(
  tree: Tree,
  changedBlobs: Map<string, string>,
  deletedPaths: Set<string>,
  prefix: string = "",
): Tree {
  const newFiles = tree.files
    .filter((f) => !deletedPaths.has(prefix + f.name))
    .map((f) => {
      const fullPath = prefix + f.name;
      const newHash = changedBlobs.get(fullPath);
      return newHash ? { ...f, hash: newHash, content: null } : f;
    });

  for (const [path, hash] of changedBlobs) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    if (!relative.includes("/") && !newFiles.some((f) => f.name === relative)) {
      newFiles.push({ name: relative, hash, content: null });
    }
  }

  const newDirs = tree.directories.map((dir) => {
    const dirPrefix = prefix + dir.name + "/";
    if (dir.content) {
      return {
        ...dir,
        content: applyBlobChangesToTree(
          dir.content,
          changedBlobs,
          deletedPaths,
          dirPrefix,
        ),
      };
    }
    return dir;
  });

  const existingDirNames = new Set(tree.directories.map((d) => d.name));
  for (const [path] of changedBlobs) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    const slashIdx = relative.indexOf("/");
    if (slashIdx === -1) continue;
    const dirName = relative.slice(0, slashIdx);
    if (
      !existingDirNames.has(dirName) &&
      !newDirs.some((d) => d.name === dirName)
    ) {
      const subTree = buildNewDirTree(changedBlobs, prefix + dirName + "/");
      newDirs.push({ name: dirName, hash: "", content: subTree });
    }
  }

  return { files: newFiles, directories: newDirs };
}

function buildNewDirTree(
  changedBlobs: Map<string, string>,
  prefix: string,
): Tree {
  const files: Tree["files"] = [];
  const dirs: Tree["directories"] = [];
  const subdirNames = new Set<string>();

  for (const [path, hash] of changedBlobs) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    const slashIdx = relative.indexOf("/");
    if (slashIdx === -1) {
      files.push({ name: relative, hash, content: null });
    } else {
      const dirName = relative.slice(0, slashIdx);
      if (!subdirNames.has(dirName)) {
        subdirNames.add(dirName);
        const subTree = buildNewDirTree(changedBlobs, prefix + dirName + "/");
        dirs.push({ name: dirName, hash: "", content: subTree });
      }
    }
  }

  return { files, directories: dirs };
}

// ---------------------------------------------------------------------------
// Core: build all objects from a patch chain
// ---------------------------------------------------------------------------

/**
 * Walk a patch chain, apply each diff to the base tree, and collect all
 * intermediate git objects (blobs, trees, commits) as PackableObjects.
 *
 * This is the "build" counterpart to patch-verify.ts's "verify" function.
 * Instead of discarding serialized bytes, we keep them for the packfile.
 *
 * @param chain         - Ordered patches (oldest first), cover letters excluded
 * @param pool          - GitGraspPool for fetching base tree and file content
 * @param signal        - AbortSignal for cancellation
 * @param fallbackUrls  - Extra clone URLs to try
 * @returns Either a successful build result or an error with conflicts
 */
export async function buildPatchChainObjects(
  chain: Patch[],
  pool: GitGraspPool,
  signal: AbortSignal,
  fallbackUrls?: string[],
): Promise<PatchChainBuildResult | PatchChainBuildError> {
  if (chain.length === 0) {
    return { reason: "Empty patch chain", conflicts: [] };
  }

  // Find the base commit (first patch's parent-commit tag)
  const baseCommitId = chain[0].parentCommitId;
  if (!baseCommitId) {
    return {
      reason: "No parent-commit tag on root patch — cannot determine base",
      conflicts: [],
    };
  }

  // Fetch the base tree from the git server
  const baseData = await pool.getFullTree(baseCommitId, signal, fallbackUrls);
  if (!baseData) {
    return {
      reason: `Could not fetch base commit ${baseCommitId.slice(0, 8)} from git server`,
      conflicts: [],
    };
  }

  const objects: PackableObject[] = [];
  const hashResults = new Map<
    string,
    { computed: string; claimed: string; match: boolean }
  >();
  let allHashesVerified = true;

  let currentTree = baseData.tree;
  let currentParentCommitId = baseCommitId;
  const fileContents = new Map<string, string>();

  for (let patchIdx = 0; patchIdx < chain.length; patchIdx++) {
    const patch = chain[patchIdx];

    if (signal.aborted) {
      return { reason: "Aborted", conflicts: [] };
    }

    const claimedHash = patch.commitId;
    if (!claimedHash) {
      return {
        reason: `Patch ${patchIdx + 1} has no commit ID tag`,
        conflicts: [],
      };
    }

    const patchDiff = extractPatchDiff(patch.content);
    if (!patchDiff) {
      return {
        reason: `Patch ${patchIdx + 1} has no diff content`,
        conflicts: [],
      };
    }

    const stripped = normalizeDiffPrefix(stripTrailer(patchDiff));
    const files = parseDiff(stripped);

    const changedBlobs = new Map<string, string>();
    const deletedPaths = new Set<string>();
    const conflicts: MergeConflict[] = [];

    for (const file of files) {
      if (signal.aborted) {
        return { reason: "Aborted", conflicts: [] };
      }

      const filePath = getFilePath(file);

      if (file.deleted) {
        deletedPaths.add(filePath);
        fileContents.delete(filePath);
        continue;
      }

      // Get original content
      let originalContent = "";
      if (!file.new && file.from && file.from !== "/dev/null") {
        if (fileContents.has(file.from)) {
          originalContent = fileContents.get(file.from)!;
        } else {
          try {
            const obj = await pool.getObjectByPath(
              baseCommitId,
              file.from,
              signal,
              fallbackUrls,
            );
            if (obj?.data) {
              originalContent = new TextDecoder().decode(obj.data);
            }
          } catch {
            return {
              reason: `Could not fetch original content for ${file.from}`,
              conflicts: [
                {
                  path: file.from,
                  reason:
                    "Could not fetch original file content from git server",
                  patchIndex: patchIdx,
                },
              ],
            };
          }
        }
      }

      // Apply the patch
      const diffString = reconstructPerFileDiff(file);
      let result = applyPatch(originalContent, diffString);
      if (result === false) {
        result = applyPatch(originalContent, diffString, { fuzzFactor: 3 });
        if (result === false) {
          conflicts.push({
            path: filePath,
            reason: `Patch failed to apply cleanly`,
            patchIndex: patchIdx,
          });
          continue;
        }
      }

      // Create blob object and collect it
      const contentBytes = encoder.encode(result);
      const blobObj = await packBlob(contentBytes);
      objects.push(blobObj);

      changedBlobs.set(filePath, blobObj.hash);
      fileContents.set(filePath, result);
    }

    if (conflicts.length > 0) {
      return {
        reason: `Patch ${patchIdx + 1} has conflicts`,
        conflicts,
      };
    }

    // Rebuild tree, collecting all tree objects
    const treeHash = await rebuildTreeCollecting(
      currentTree,
      changedBlobs,
      deletedPaths,
      objects,
    );

    // Update the in-memory tree for the next patch
    currentTree = applyBlobChangesToTree(
      currentTree,
      changedBlobs,
      deletedPaths,
    );

    // Build commit object
    const author = parsePersonTag(patch, "author");
    const committer = parsePersonTag(patch, "committer");

    if (!author) {
      return {
        reason: `Patch ${patchIdx + 1} has no author tag — cannot reconstruct commit`,
        conflicts: [],
      };
    }

    const subject = patch.subject;
    const body = patch.body;
    const message = body ? `${subject}\n\n${body}` : subject;
    const gpgSig = extractGpgSignature(patch);

    const commitData: CommitData = {
      treeHash,
      parentHashes: [currentParentCommitId],
      author,
      committer: committer ?? author,
      message,
      gpgSignature: gpgSig,
    };

    const commitObj = await packCommit(commitData);
    objects.push(commitObj);

    // Verify hash
    const match = commitObj.hash === claimedHash;
    hashResults.set(patch.event.id, {
      computed: commitObj.hash,
      claimed: claimedHash,
      match,
    });
    if (!match) allHashesVerified = false;

    currentParentCommitId = claimedHash;
  }

  return {
    objects,
    finalTreeHash:
      objects.filter((o) => o.type === "tree").slice(-1)[0]?.hash ?? "",
    tipCommitHash: currentParentCommitId,
    allHashesVerified,
    hashResults,
  };
}

// ---------------------------------------------------------------------------
// Merge commit creation
// ---------------------------------------------------------------------------

/**
 * Create a merge commit PackableObject.
 *
 * The merge commit has:
 *   - tree = finalTreeHash (the tree after all patches applied)
 *   - parents = [defaultBranchHead, patchTipCommitHash]
 *   - author = patch author (from the root patch)
 *   - committer = the logged-in maintainer
 *   - message = "Merge patch '<subject>' from <author-name>"
 *
 * @param finalTreeHash       - Tree hash from buildPatchChainObjects
 * @param defaultBranchHead   - Current HEAD of the default branch
 * @param patchTipCommitHash  - Tip commit hash of the patch chain
 * @param committer           - The maintainer performing the merge
 * @param subject             - The PR/patch subject for the merge message
 * @param authorName          - The patch author's display name
 */
export async function createMergeCommitObject(
  finalTreeHash: string,
  defaultBranchHead: string,
  patchTipCommitHash: string,
  committer: CommitPerson,
  subject: string,
  authorName: string,
): Promise<PackableObject> {
  const message = `Merge patch '${subject}' from ${authorName}`;

  const commitData: CommitData = {
    treeHash: finalTreeHash,
    parentHashes: [defaultBranchHead, patchTipCommitHash],
    author: committer,
    committer,
    message,
  };

  return packCommit(commitData);
}
