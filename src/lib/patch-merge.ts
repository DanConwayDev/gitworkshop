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
import { applyPatch, createTwoFilesPatch } from "diff";
import {
  gitObjectBytes,
  sha1hex,
  serializeTreeContent,
  parseCommitParentHashes,
  type TreeEntry,
  type CommitData,
  type CommitPerson,
} from "@/lib/git-objects";
import { packBlob, packCommit, type PackableObject } from "@/lib/git-packfile";
import { extractPatchDiff } from "@/lib/nip34";
import { normalizeDiffPrefix } from "@/lib/patch-verify";
import { formatTimezone, extractGpgSignature } from "@/lib/patch-commits";
import type { Patch } from "@/casts/Patch";
import { diffTrees, type GitGraspPool } from "@/lib/git-grasp-pool";
import type { Tree } from "@/lib/vendored/git-natural-api";

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
    entries.push({ mode: file.mode, name: file.name, hash });
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
      entries.push({ mode: dir.mode, name: dir.name, hash: subHash });
    } else {
      entries.push({ mode: dir.mode, name: dir.name, hash: dir.hash });
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
      newFiles.push({ name: relative, hash, mode: "100644", content: null });
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
      newDirs.push({
        name: dirName,
        hash: "",
        mode: "40000",
        content: subTree,
      });
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
      files.push({ name: relative, hash, mode: "100644", content: null });
    } else {
      const dirName = relative.slice(0, slashIdx);
      if (!subdirNames.has(dirName)) {
        subdirNames.add(dirName);
        const subTree = buildNewDirTree(changedBlobs, prefix + dirName + "/");
        dirs.push({ name: dirName, hash: "", mode: "40000", content: subTree });
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
 * @param chain              - Ordered patches (oldest first), cover letters excluded
 * @param pool               - GitGraspPool for fetching base tree and file content
 * @param signal             - AbortSignal for cancellation
 * @param fallbackUrls       - Extra clone URLs to try
 * @param guessedBaseCommitId - Fallback base commit when the first patch has no
 *                              `parent-commit` tag (e.g. from the timestamp heuristic).
 * @param defaultBranchHead  - Current HEAD of the default branch. When supplied
 *                              and the branch has advanced past the patch base,
 *                              the returned `finalTreeHash` is a real three-way
 *                              merge of the patch result into the branch tip
 *                              (preserving the branch's own changes) instead of
 *                              the raw patch-tip tree. A conflict here is
 *                              returned as an error so the caller can fall back
 *                              to apply-to-tip.
 * @returns Either a successful build result or an error with conflicts
 */
export async function buildPatchChainObjects(
  chain: Patch[],
  pool: GitGraspPool,
  signal: AbortSignal,
  fallbackUrls?: string[],
  guessedBaseCommitId?: string,
  defaultBranchHead?: string,
): Promise<PatchChainBuildResult | PatchChainBuildError> {
  if (chain.length === 0) {
    return { reason: "Empty patch chain", conflicts: [] };
  }

  // Find the base commit: prefer the explicit parent-commit tag, fall back to
  // the guessed base (from the timestamp heuristic).
  const baseCommitId = chain[0].parentCommitId ?? guessedBaseCommitId;
  if (!baseCommitId) {
    return {
      reason:
        "No parent-commit tag on root patch and no base commit could be guessed — cannot determine base",
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
            } else {
              // File not found in the base tree — this is an unresolvable conflict.
              // The patch modifies a file that doesn't exist in the target repo.
              conflicts.push({
                path: file.from,
                reason: "File does not exist in the target repository",
                patchIndex: patchIdx,
              });
              continue;
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

  const patchTipTreeHash =
    objects.filter((o) => o.type === "tree").slice(-1)[0]?.hash ?? "";

  let finalTreeHash = patchTipTreeHash;

  // Three-way merge against the current default-branch tip when it has advanced
  // past the patch base. Without this the merge commit would adopt the patch
  // result tree verbatim and silently revert every change made on the branch
  // since the base — the same data-loss disaster as the PR path. A conflict is
  // returned as an error so the caller can fall back to apply-to-tip.
  if (defaultBranchHead && defaultBranchHead !== baseCommitId) {
    const oursData = await pool.getFullTree(
      defaultBranchHead,
      signal,
      fallbackUrls,
    );
    if (signal.aborted) return { reason: "Aborted", conflicts: [] };
    if (!oursData) {
      return {
        reason: `Could not fetch default branch commit ${defaultBranchHead.slice(
          0,
          8,
        )} for three-way merge`,
        conflicts: [],
      };
    }

    // The patch chain's "theirs" blobs only exist locally (built above, not yet
    // pushed), so the three-way merge must read their content from here.
    const localBlobs = new Map<string, Uint8Array>();
    for (const o of objects) {
      if (o.type === "blob") localBlobs.set(o.hash, o.data);
    }

    const merged = await mergeThreeWayTree(
      pool,
      signal,
      baseData.tree,
      oursData.tree,
      currentTree,
      fallbackUrls,
      localBlobs,
    );
    if (signal.aborted) return { reason: "Aborted", conflicts: [] };
    if ("reason" in merged) return merged;

    finalTreeHash = merged.mergeTreeHash;
    objects.push(...merged.objects);
  }

  return {
    objects,
    finalTreeHash,
    tipCommitHash: currentParentCommitId,
    allHashesVerified,
    hashResults,
  };
}

// ---------------------------------------------------------------------------
// Apply-to-tip: replay patch chain as linear commits on top of defaultBranchHead
// ---------------------------------------------------------------------------

/**
 * Result of applying a patch chain directly on top of the default branch tip.
 * Produces linear commits — no merge commit.
 */
export interface PatchChainApplyResult {
  /** All git objects needed for the packfile (blobs + trees + commits) */
  objects: PackableObject[];
  /** The commit hash of the last replayed commit (new tip of the branch) */
  newTipCommitHash: string;
  /** Whether all claimed commit hashes matched the computed ones */
  allHashesVerified: boolean;
  /** Per-patch hash verification: patch event ID -> match/mismatch */
  hashResults: Map<
    string,
    { computed: string; claimed: string; match: boolean }
  >;
}

/**
 * Apply a patch chain directly on top of the current default branch HEAD,
 * producing linear commits (no merge commit). This is the "git am" / "apply"
 * flow as opposed to the "merge" flow.
 *
 * Each patch is replayed as a new commit whose:
 *   - tree = result of applying the patch diff to the previous tree
 *   - parent = previous commit (starting from defaultBranchHead)
 *   - author = original patch author (name, email, timestamp preserved)
 *   - committer = the maintainer performing the apply (passed in)
 *
 * @param chain               - Ordered patches (oldest first), cover letters excluded
 * @param pool                - GitGraspPool for fetching base tree and file content
 * @param defaultBranchHead   - Current HEAD of the default branch (apply target)
 * @param maintainerCommitter - The maintainer performing the apply (committer field)
 * @param signal              - AbortSignal for cancellation
 * @param fallbackUrls        - Extra clone URLs to try
 */
export async function applyPatchChainToTip(
  chain: Patch[],
  pool: GitGraspPool,
  defaultBranchHead: string,
  maintainerCommitter: CommitPerson,
  signal: AbortSignal,
  fallbackUrls?: string[],
): Promise<PatchChainApplyResult | PatchChainBuildError> {
  if (chain.length === 0) {
    return { reason: "Empty patch chain", conflicts: [] };
  }

  // Fetch the tip tree from the git server
  const tipData = await pool.getFullTree(
    defaultBranchHead,
    signal,
    fallbackUrls,
  );
  if (!tipData) {
    return {
      reason: `Could not fetch tip commit ${defaultBranchHead.slice(0, 8)} from git server`,
      conflicts: [],
    };
  }

  const objects: PackableObject[] = [];
  const hashResults = new Map<
    string,
    { computed: string; claimed: string; match: boolean }
  >();
  let allHashesVerified = true;

  let currentTree = tipData.tree;
  let currentParentCommitId = defaultBranchHead;
  const fileContents = new Map<string, string>();

  // We fetch file content from the tip tree, not the original base.
  // Track the "effective base" for each file as we apply patches sequentially.
  // Initially all files come from the tip tree.

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

      // Get current content from the tip tree (or from a previous patch in this chain)
      let originalContent = "";
      if (!file.new && file.from && file.from !== "/dev/null") {
        if (fileContents.has(file.from)) {
          originalContent = fileContents.get(file.from)!;
        } else {
          try {
            const obj = await pool.getObjectByPath(
              defaultBranchHead,
              file.from,
              signal,
              fallbackUrls,
            );
            if (obj?.data) {
              originalContent = new TextDecoder().decode(obj.data);
            } else {
              // File not found in the tip tree — this is an unresolvable conflict.
              // The patch modifies a file that doesn't exist in the target repository.
              conflicts.push({
                path: file.from,
                reason: "File does not exist in the target repository",
                patchIndex: patchIdx,
              });
              continue;
            }
          } catch {
            return {
              reason: `Could not fetch content for ${file.from} from tip commit`,
              conflicts: [
                {
                  path: file.from,
                  reason: "Could not fetch file content from git server tip",
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
            reason: `Patch failed to apply cleanly against tip`,
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
        reason: `Patch ${patchIdx + 1} has conflicts against tip`,
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

    // Build commit object — preserve original author, use maintainer as committer
    const author = parsePersonTag(patch, "author");
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
      // Committer is the maintainer applying the patch, not the original committer
      committer: maintainerCommitter,
      message,
      // GPG signature from the original commit is intentionally dropped:
      // the commit hash will differ (different parent, different committer),
      // so the original signature would be invalid anyway.
      gpgSignature: gpgSig,
    };

    const commitObj = await packCommit(commitData);
    objects.push(commitObj);

    // Verify hash — note: this will almost always mismatch because the parent
    // and committer differ from the original. We track it for transparency.
    const match = commitObj.hash === claimedHash;
    hashResults.set(patch.event.id, {
      computed: commitObj.hash,
      claimed: claimedHash,
      match,
    });
    if (!match) allHashesVerified = false;

    // Use the computed hash (not the claimed one) as the parent for the next commit,
    // since we're building a new linear chain on top of the tip.
    currentParentCommitId = commitObj.hash;
  }

  return {
    objects,
    newTipCommitHash: currentParentCommitId,
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
 *   - message = "Merge patch '<subject>' from <author-name>\n\n<description>\n\nNostr-PR: <nevent>"
 *
 * @param finalTreeHash       - Tree hash from buildPatchChainObjects
 * @param defaultBranchHead   - Current HEAD of the default branch
 * @param patchTipCommitHash  - Tip commit hash of the patch chain
 * @param committer           - The maintainer performing the merge
 * @param subject             - The PR/patch subject for the merge message
 * @param itemType            - Whether this is a "patch" (kind:1617) or "pr" (kind:1618)
 * @param nevent              - NIP-19 nevent identifier for the PR/patch event
 * @param description         - Cover note content or original PR body (optional)
 */
export async function createMergeCommitObject(
  finalTreeHash: string,
  defaultBranchHead: string,
  patchTipCommitHash: string,
  committer: CommitPerson,
  subject: string,
  itemType: "patch" | "pr",
  nevent: string,
  description?: string,
): Promise<PackableObject> {
  const label = itemType === "pr" ? "PR" : "patch";
  let message = `Merge ${label} '${subject}'`;

  if (description && description.trim()) {
    message += `\n\n${description.trim()}`;
  }

  message += `\n\nNostr-PR: ${nevent}`;

  const commitData: CommitData = {
    treeHash: finalTreeHash,
    parentHashes: [defaultBranchHead, patchTipCommitHash],
    author: committer,
    committer,
    message,
  };

  return packCommit(commitData);
}

// ---------------------------------------------------------------------------
// Three-way merge tree
// ---------------------------------------------------------------------------

/** Successful result of {@link mergeThreeWayTree}. */
export interface ThreeWayMergeResult {
  /**
   * NEW git objects produced by the merge that must be packed and pushed:
   * the rebuilt tree objects plus any blobs created by an auto-merge. Blobs
   * taken verbatim from either side are referenced by hash but NOT included
   * (they already exist wherever their side's objects live).
   */
  objects: PackableObject[];
  /** Tree hash of the merged result (the merge commit's tree). */
  mergeTreeHash: string;
}

const textDecoder = new TextDecoder();

/**
 * Compute the tree for a real three-way merge of `theirs` into `ours`.
 *
 * This is what makes a merge SAFE when the default branch has advanced past
 * the merge base: instead of blindly adopting the incoming tip's tree (which
 * silently reverts every change made on the default branch since the base —
 * the data-loss disaster an incorrect merge base triggers), we combine both
 * sides' changes relative to their common ancestor.
 *
 * For every path:
 *   - changed only on theirs → take theirs.
 *   - changed only on ours   → keep ours (it is already in `oursTree`).
 *   - changed on both to the same result → keep it.
 *   - modified on both differently → generate the base→theirs patch and apply
 *     it on top of ours' content; clean apply → merged blob, otherwise a
 *     conflict.
 *   - delete vs. modify, or add vs. add with different content → conflict.
 *
 * The merged tree is rebuilt from `oursTree` with theirs' deltas layered on
 * top, so files only ours touched are preserved.
 *
 * @param pool         - GitGraspPool for fetching blob content.
 * @param signal       - AbortSignal for cancellation.
 * @param baseTree     - Tree at the merge base (common ancestor).
 * @param oursTree     - Tree at the current default-branch tip ("ours").
 * @param theirsTree   - Tree at the incoming PR/patch tip ("theirs").
 * @param fallbackUrls - Extra clone URLs to try when fetching blobs.
 * @param localBlobs   - Optional hash→content map consulted before the pool.
 *                       Required for the patch path, whose "theirs" blobs only
 *                       exist locally (built from patch events, not yet pushed).
 * @returns The merged tree + new objects, or a {@link PatchChainBuildError}
 *          listing the conflicting paths.
 */
export async function mergeThreeWayTree(
  pool: GitGraspPool,
  signal: AbortSignal,
  baseTree: Tree,
  oursTree: Tree,
  theirsTree: Tree,
  fallbackUrls?: string[],
  localBlobs?: Map<string, Uint8Array>,
): Promise<ThreeWayMergeResult | PatchChainBuildError> {
  const theirsChanges = diffTrees(theirsTree, baseTree);
  const oursChanges = diffTrees(oursTree, baseTree);
  const oursByPath = new Map(oursChanges.map((c) => [c.path, c]));

  const objects: PackableObject[] = [];
  const changedBlobs = new Map<string, string>();
  const deletedPaths = new Set<string>();
  const conflicts: MergeConflict[] = [];

  const fetchText = async (hash: string): Promise<string | null> => {
    const local = localBlobs?.get(hash);
    if (local) return textDecoder.decode(local);
    const data = await pool.getBlob(hash, signal, fallbackUrls);
    return data ? textDecoder.decode(data) : null;
  };

  for (const tc of theirsChanges) {
    if (signal.aborted) return { reason: "Aborted", conflicts: [] };

    const oc = oursByPath.get(tc.path);

    // ── Path touched only by theirs → take theirs verbatim ───────────────
    if (!oc) {
      if (tc.status === "deleted") {
        deletedPaths.add(tc.path);
      } else if (tc.tipHash) {
        changedBlobs.set(tc.path, tc.tipHash);
      }
      continue;
    }

    // ── Path touched by both sides ───────────────────────────────────────
    if (tc.status === "deleted" && oc.status === "deleted") {
      deletedPaths.add(tc.path); // both removed it
      continue;
    }
    if (tc.status === "deleted" || oc.status === "deleted") {
      conflicts.push({
        path: tc.path,
        reason: "Modified on one side and deleted on the other",
        patchIndex: 0,
      });
      continue;
    }
    // Both produced the same blob → already correct in oursTree.
    if (tc.tipHash && oc.tipHash && tc.tipHash === oc.tipHash) continue;

    // Different content on both sides → attempt an automatic 3-way content merge.
    const baseContent = tc.baseHash ? await fetchText(tc.baseHash) : "";
    const theirsContent = tc.tipHash ? await fetchText(tc.tipHash) : null;
    const oursContent = oc.tipHash ? await fetchText(oc.tipHash) : null;
    if (signal.aborted) return { reason: "Aborted", conflicts: [] };

    if (theirsContent === null || oursContent === null) {
      conflicts.push({
        path: tc.path,
        reason: "Could not fetch file content for three-way merge",
        patchIndex: 0,
      });
      continue;
    }

    if (oursContent === theirsContent) continue; // identical result, keep ours

    // Apply theirs' delta (base → theirs) on top of ours' content.
    const patch = createTwoFilesPatch(
      `a/${tc.path}`,
      `b/${tc.path}`,
      baseContent ?? "",
      theirsContent,
      "",
      "",
      { context: 3 },
    );
    let merged = applyPatch(oursContent, patch);
    if (merged === false)
      merged = applyPatch(oursContent, patch, { fuzzFactor: 3 });
    if (merged === false) {
      conflicts.push({
        path: tc.path,
        reason: "Conflicting changes — could not auto-merge",
        patchIndex: 0,
      });
      continue;
    }

    const blob = await packBlob(encoder.encode(merged));
    objects.push(blob);
    changedBlobs.set(tc.path, blob.hash);
  }

  if (conflicts.length > 0) {
    return {
      reason: `Three-way merge produced ${conflicts.length} conflict${
        conflicts.length === 1 ? "" : "s"
      }`,
      conflicts,
    };
  }

  const mergeTreeHash = await rebuildTreeCollecting(
    oursTree,
    changedBlobs,
    deletedPaths,
    objects,
  );

  return { objects, mergeTreeHash };
}

// ---------------------------------------------------------------------------
// Fast-forward safety guard
// ---------------------------------------------------------------------------

/** A 40-char all-zero hash denotes "no previous value" (branch creation). */
const ZERO_HASH = "0".repeat(40);

/**
 * Safety guard run immediately before pushing a branch update.
 *
 * Refuse to advance a branch unless the new tip provably descends from the
 * current tip — i.e. the update is a fast-forward. A non-fast-forward push
 * rewrites the branch and silently ORPHANS every commit that was reachable
 * from the old tip but not the new one. For a merge this is the disaster the
 * guard exists to prevent: if the merge base is computed incorrectly (e.g. the
 * patch tree was built against a stale or unrelated base, dragging commits that
 * are already on the branch into the "PR"), the resulting merge commit may not
 * list the current branch tip among its parents, and pushing it would drop
 * real history.
 *
 * The check walks the new tip's ancestry through the parent links of the
 * commits being pushed, looking for `oldHash`. This works for every merge
 * strategy in the app:
 *   - **merge / PR merge**: `oldHash` is a direct parent of the merge commit.
 *   - **apply-to-tip**: `oldHash` is the parent of the first replayed commit,
 *     reached by following the linear chain of pushed commits.
 *
 * We can only traverse the commits included in `objects`, but for all of the
 * above the entire path from the new tip back to `oldHash` lies within the
 * pushed set, so reaching `oldHash` confirms the fast-forward. Branch creation
 * (`oldHash` empty or all-zero) and no-op updates are always allowed.
 *
 * @throws Error when the new tip does not descend from the current tip.
 */
export function assertFastForwardSafe(
  objects: PackableObject[],
  oldHash: string,
  newHash: string,
): void {
  // Creating a brand-new branch has no previous tip to preserve.
  if (!oldHash || oldHash === ZERO_HASH) return;
  // No-op update (or already-at-target) is trivially safe.
  if (oldHash === newHash) return;

  const commitsByHash = new Map<string, PackableObject>();
  for (const obj of objects) {
    if (obj.type === "commit") commitsByHash.set(obj.hash, obj);
  }

  // Breadth-first walk of the new tip's ancestry within the pushed commits,
  // searching for the previous tip.
  const visited = new Set<string>();
  const queue: string[] = [newHash];
  while (queue.length > 0) {
    const hash = queue.shift()!;
    if (hash === oldHash) return; // reachable → fast-forward safe
    if (visited.has(hash)) continue;
    visited.add(hash);
    const commit = commitsByHash.get(hash);
    if (!commit) continue; // outside the pushed set — can't traverse further
    for (const parent of parseCommitParentHashes(commit.data)) {
      queue.push(parent);
    }
  }

  throw new Error(
    `Refusing to push: the new tip ${newHash.slice(0, 8)} does not descend from ` +
      `the current branch tip ${oldHash.slice(0, 8)} (it is not in the new tip's ` +
      `ancestry). Pushing it would orphan commits on the branch — a ` +
      `non-fast-forward update. This usually indicates an incorrect merge base; ` +
      `aborting before any history is lost.`,
  );
}
