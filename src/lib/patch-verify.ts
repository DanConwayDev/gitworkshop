/**
 * patch-verify — verification for patch-sourced commits.
 *
 * Two levels of verification:
 *
 * 1. **Blob hash spot-check** (verifyPatchDiffBlobs): Lightweight check that
 *    verifies new-file blob hashes from the diff's `index` lines. Doesn't
 *    need a git server.
 *
 * 2. **Full commit hash verification** (verifyPatchChainCommitHashes): Walks
 *    the entire patch chain, starting from the base tree fetched from the git
 *    server. For each patch: applies the diff, rebuilds the tree, computes
 *    the commit hash, and compares to the claimed hash. The output tree of
 *    patch N becomes the input tree for patch N+1 — so patches whose parent
 *    is another patch in the chain don't need the git server.
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

export interface BlobMismatch {
  path: string;
  expected: string;
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
// Tree rebuilding
// ---------------------------------------------------------------------------

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

  for (const [path, hash] of changedBlobs) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    if (!relative.includes("/")) {
      if (!entries.some((e) => e.name === relative)) {
        entries.push({ mode: "100644", name: relative, hash });
      }
    }
  }

  for (const dir of tree.directories) {
    const dirPrefix = prefix + dir.name + "/";
    if (dir.content) {
      const subHash = await rebuildTreeHash(
        dir.content,
        changedBlobs,
        deletedPaths,
        dirPrefix,
      );
      entries.push({ mode: "40000", name: dir.name, hash: subHash });
    } else {
      entries.push({ mode: "40000", name: dir.name, hash: dir.hash });
    }
  }

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
    const subHash = await buildNewDirTreeHash(files);
    entries.push({ mode: "40000", name: dirName, hash: subHash });
  }

  return gitTreeHash(entries);
}

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

// ---------------------------------------------------------------------------
// Mutate a Tree in-place to reflect changed/added/deleted blobs.
// Returns a new Tree (shallow copy) with updated hashes.
// ---------------------------------------------------------------------------

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

  // Add new files at this level
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

  // Add new directories
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
      // Build a minimal tree for the new directory
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
// Core: apply a single patch to a tree and compute the commit hash
// ---------------------------------------------------------------------------

interface ApplyPatchResult {
  /** The tree after applying this patch */
  newTree: Tree;
  /** The computed tree hash */
  treeHash: string;
  /** The verification result for this patch */
  result: CommitHashResult;
}

/**
 * Apply a single patch to a parent tree and verify the commit hash.
 *
 * @param patch - The patch to apply
 * @param parentTree - The parent tree (from git server or previous patch)
 * @param parentCommitId - The parent commit hash (for the commit object)
 * @param pool - GitGraspPool for fetching original file content
 * @param signal - AbortSignal
 * @param fallbackUrls - Extra clone URLs
 * @param baseCommitId - The original base commit on the git server (for
 *   fetching file content via getObjectByPath — we always fetch from the
 *   base commit since intermediate patch commits don't exist on the server)
 * @param fileContents - Accumulated file contents from previous patches in
 *   the chain. Updated in-place with new file contents from this patch.
 */
async function applyPatchToTree(
  patch: Patch,
  parentTree: Tree,
  parentCommitId: string,
  pool: GitGraspPool,
  signal: AbortSignal,
  fallbackUrls: string[] | undefined,
  baseCommitId: string,
  fileContents: Map<string, string>,
): Promise<ApplyPatchResult | { error: CommitHashResult }> {
  const claimedHash = patch.commitId;
  if (!claimedHash) {
    return {
      error: {
        status: "unavailable",
        reason: "No commit ID tag on this patch",
      },
    };
  }

  const patchDiff = extractPatchDiff(patch.content);
  if (!patchDiff) {
    return {
      error: { status: "unavailable", reason: "No diff content in patch" },
    };
  }

  const stripped = stripTrailer(patchDiff);
  const files = parseDiff(stripped);

  const changedBlobs = new Map<string, string>();
  const deletedPaths = new Set<string>();

  for (const file of files) {
    if (signal.aborted) {
      return { error: { status: "unavailable", reason: "Aborted" } };
    }

    const filePath = getFilePath(file);

    if (file.deleted) {
      deletedPaths.add(filePath);
      fileContents.delete(filePath);
      continue;
    }

    // Get original content: first check accumulated contents from previous
    // patches, then fetch from the git server using the base commit
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
            error: {
              status: "unavailable",
              reason: `Could not fetch original content for ${file.from}`,
            },
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
        return {
          error: {
            status: "unavailable",
            reason: `Patch failed to apply for ${filePath}`,
          },
        };
      }
    }

    const newHash = await gitBlobHashFromString(result);
    changedBlobs.set(filePath, newHash);
    fileContents.set(filePath, result);
  }

  // Rebuild tree
  const treeHash = await rebuildTreeHash(
    parentTree,
    changedBlobs,
    deletedPaths,
  );
  const newTree = applyBlobChangesToTree(
    parentTree,
    changedBlobs,
    deletedPaths,
  );

  // Build commit object
  const author = parsePersonTag(patch, "author");
  const committer = parsePersonTag(patch, "committer");

  if (!author) {
    return {
      error: {
        status: "unavailable",
        reason: "No author tag — cannot reconstruct commit object",
      },
    };
  }

  const subject = patch.subject;
  const body = patch.body;
  const message = body ? `${subject}\n\n${body}` : subject;
  const gpgSig = extractGpgSignature(patch);

  const commitData: CommitData = {
    treeHash,
    parentHashes: [parentCommitId],
    author,
    committer: committer ?? author,
    message,
    gpgSignature: gpgSig,
  };

  const computedHash = await gitCommitHash(commitData);

  const result: CommitHashResult =
    computedHash === claimedHash
      ? { status: "match", computed: computedHash, claimed: claimedHash }
      : { status: "mismatch", computed: computedHash, claimed: claimedHash };

  return { newTree, treeHash, result };
}

// ---------------------------------------------------------------------------
// Public API: verify an entire patch chain
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// sessionStorage cache for chain verification results
// ---------------------------------------------------------------------------

const CACHE_PREFIX = "patch-verify-v1:";

function chainCacheKey(chain: Patch[]): string {
  // Stable key: base commit + sorted patch event IDs
  const baseCommitId = chain[0]?.parentCommitId ?? "unknown";
  const ids = chain.map((p) => p.event.id).join(",");
  return CACHE_PREFIX + baseCommitId + ":" + ids;
}

/**
 * Synchronously read cached verification results for a chain.
 * Returns null if not cached. Use this to initialise component state
 * before the async verification runs.
 */
export function readCachedChainResults(
  chain: Patch[],
): Map<string, CommitHashResult> | null {
  if (chain.length === 0) return null;
  return readCachedResults(chainCacheKey(chain));
}

function readCachedResults(key: string): Map<string, CommitHashResult> | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Array<[string, CommitHashResult]>;
    return new Map(parsed);
  } catch {
    return null;
  }
}

function writeCachedResults(
  key: string,
  results: Map<string, CommitHashResult>,
): void {
  try {
    // Only cache definitive results (match/mismatch), not unavailable ones —
    // unavailable may be transient (pool not ready, network error).
    const definitive = [...results.entries()].filter(
      ([, r]) => r.status === "match" || r.status === "mismatch",
    );
    if (definitive.length === 0) return;
    sessionStorage.setItem(key, JSON.stringify(definitive));
  } catch {
    // sessionStorage full or unavailable — silently skip
  }
}

// ---------------------------------------------------------------------------
// In-flight deduplication: if the same chain is already being verified,
// return the same promise rather than starting a second run.
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<Map<string, CommitHashResult>>>();

/**
 * Verify commit hashes for all patches in a chain.
 *
 * Walks the chain from first to last:
 *   1. Fetches the base tree from the git server (first patch's parent)
 *   2. For each patch: applies the diff to the current tree, computes the
 *      commit hash, compares to the claimed hash
 *   3. The output tree of patch N becomes the input for patch N+1
 *
 * Results are cached in sessionStorage keyed by chain fingerprint so
 * revisiting the same commit detail page is instant.
 *
 * Returns a Map of patch event ID → CommitHashResult.
 */
export async function verifyPatchChainCommitHashes(
  chain: Patch[],
  pool: GitGraspPool,
  signal: AbortSignal,
  fallbackUrls?: string[],
): Promise<Map<string, CommitHashResult>> {
  const results = new Map<string, CommitHashResult>();

  if (chain.length === 0) return results;

  // Check sessionStorage cache first
  const cacheKey = chainCacheKey(chain);
  const cached = readCachedResults(cacheKey);
  if (cached && cached.size > 0) return cached;

  // Deduplicate concurrent calls for the same chain
  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = runVerification(chain, pool, signal, fallbackUrls, cacheKey);
  inFlight.set(cacheKey, promise);
  promise.finally(() => inFlight.delete(cacheKey));
  return promise;
}

async function runVerification(
  chain: Patch[],
  pool: GitGraspPool,
  signal: AbortSignal,
  fallbackUrls: string[] | undefined,
  cacheKey: string,
): Promise<Map<string, CommitHashResult>> {
  const results = new Map<string, CommitHashResult>();

  if (chain.length === 0) return results;

  // Find the base commit (first patch's parent-commit tag)
  const baseCommitId = chain[0].parentCommitId;
  if (!baseCommitId) {
    for (const patch of chain) {
      results.set(patch.event.id, {
        status: "unavailable",
        reason: "No parent-commit tag on root patch",
      });
    }
    return results;
  }

  // Fetch the base tree from the git server
  const baseData = await pool.getFullTree(baseCommitId, signal, fallbackUrls);
  if (!baseData) {
    for (const patch of chain) {
      results.set(patch.event.id, {
        status: "unavailable",
        reason: "Could not fetch base commit from git server",
      });
    }
    return results;
  }

  let currentTree = baseData.tree;
  let currentParentCommitId = baseCommitId;
  const fileContents = new Map<string, string>();

  for (const patch of chain) {
    if (signal.aborted) {
      results.set(patch.event.id, {
        status: "unavailable",
        reason: "Aborted",
      });
      continue;
    }

    const patchResult = await applyPatchToTree(
      patch,
      currentTree,
      currentParentCommitId,
      pool,
      signal,
      fallbackUrls,
      baseCommitId,
      fileContents,
    );

    if ("error" in patchResult) {
      results.set(patch.event.id, patchResult.error);
      // Can't continue the chain if this patch failed
      for (const remaining of chain.slice(chain.indexOf(patch) + 1)) {
        results.set(remaining.event.id, {
          status: "unavailable",
          reason: "Previous patch in chain failed verification",
        });
      }
      break;
    }

    results.set(patch.event.id, patchResult.result);
    currentTree = patchResult.newTree;
    currentParentCommitId = patch.commitId ?? currentParentCommitId;
  }

  writeCachedResults(cacheKey, results);
  return results;
}

/**
 * Verify a single patch's commit hash. Convenience wrapper that handles
 * the common case of verifying just one patch (the root patch).
 *
 * For patches that are part of a chain, use verifyPatchChainCommitHashes
 * instead — it builds parent trees incrementally.
 */
export async function verifyPatchCommitHash(
  patch: Patch,
  pool: GitGraspPool,
  signal: AbortSignal,
  fallbackUrls?: string[],
): Promise<CommitHashResult> {
  const results = await verifyPatchChainCommitHashes(
    [patch],
    pool,
    signal,
    fallbackUrls,
  );
  return (
    results.get(patch.event.id) ?? {
      status: "unavailable",
      reason: "Verification produced no result",
    }
  );
}
