/**
 * Vendored from @fiatjaf/git-natural-api v0.2.4
 * https://jsr.io/@fiatjaf/git-natural-api
 */

import {
  createWantRequest,
  defaultCapabilities,
  fetchPackfile,
  necessaryCapabilities,
  requiredCapabilities,
} from "./packs.ts";
import { type Commit, parseCommit } from "./commits.ts";
import type { ParsedObject } from "./parse-packfile.ts";
import {
  getCapabilities,
  getInfoRefs,
  type InfoRefsUploadPackResponse,
} from "./refs.ts";
import { loadTree, type Tree, type TreeEntry } from "./tree.ts";

export { fetchPackfile, MissingRef, createWantRequest } from "./packs.ts";
export type { ParsedObject } from "./parse-packfile.ts";
export { type Commit, parseCommit } from "./commits.ts";
export { getInfoRefs, type InfoRefsUploadPackResponse } from "./refs.ts";
export { loadTree, parseTree, type Tree, type TreeEntry } from "./tree.ts";
export { getCommitDiff } from "./diff.ts";

/** UTF-8 text decoder for Git object data */
export const utf8: TextDecoder = new TextDecoder("utf-8");

/** Error thrown when a Git server is missing a required capability */
export class MissingCapability extends Error {
  url: string;
  capability: string;

  constructor(url: string, capability: string) {
    super(`server at ${url} is missing required capability ${capability}`);

    this.url = url;
    this.capability = capability;
  }
}

/**
 * Fetches a specific Git object (blob, tree, commit, or tag) from a remote repository.
 * @param url Base URL of the Git repository (e.g., "https://github.com/user/repo.git")
 * @param blobHash SHA-1 hash of the object to fetch
 * @returns Promise resolving to the parsed Git object or undefined if not found
 * @throws MissingCapability if the server lacks required capabilities
 */
export async function getObject(
  url: string,
  blobHash: string,
): Promise<ParsedObject | undefined> {
  const caps = await getCapabilities(url);

  const capabilities: string[] = [];
  for (let i = 0; i < defaultCapabilities.length; i++) {
    const cap = defaultCapabilities[i];
    if (caps.includes(cap)) {
      capabilities.push(cap);
    }
  }
  for (let i = 0; i < necessaryCapabilities.length; i++) {
    const cap = necessaryCapabilities[i];
    if (caps.includes(cap)) {
      capabilities.push(cap);
    } else {
      throw new MissingCapability(url, cap);
    }
  }
  for (let i = 0; i < requiredCapabilities.length; i++) {
    const cap = requiredCapabilities[i];
    if (!caps.includes(cap)) {
      throw new MissingCapability(url, cap);
    }
  }

  const want = createWantRequest(blobHash, capabilities, 1);
  const result = await fetchPackfile(url, want);

  return result.objects.get(blobHash);
}

/**
 * Fetches the directory tree structure for a specific commit or reference.
 * @param url Base URL of the Git repository
 * @param commitOrRef Commit hash, branch name, or Git reference (e.g., "main", "HEAD", "refs/heads/main")
 * @param nestLimit Optional depth limit for directory tree traversal (0 = unlimited)
 * @returns Promise resolving to a Tree object containing the directory structure
 * @throws MissingCapability if the server lacks the "filter" capability
 */
export async function getDirectoryTreeAt(
  url: string,
  commitOrRef: string,
  nestLimit?: number,
): Promise<Tree> {
  let info: InfoRefsUploadPackResponse | undefined;
  if (commitOrRef.startsWith("refs/")) {
    info = await getInfoRefs(url);
    commitOrRef = info.refs[commitOrRef];
  }
  const caps = await getCapabilities(url, info);

  const capabilities: string[] = [];
  for (let i = 0; i < defaultCapabilities.length; i++) {
    const cap = defaultCapabilities[i];
    if (caps.includes(cap)) {
      capabilities.push(cap);
    }
  }
  for (let i = 0; i < necessaryCapabilities.length; i++) {
    const cap = necessaryCapabilities[i];
    if (caps.includes(cap)) {
      capabilities.push(cap);
    } else {
      throw new MissingCapability(url, cap);
    }
  }
  for (let i = 0; i < requiredCapabilities.length; i++) {
    const cap = requiredCapabilities[i];
    if (!caps.includes(cap)) {
      throw new MissingCapability(url, cap);
    }
  }
  if (caps.includes("filter")) {
    capabilities.push("filter");
  } else {
    throw new MissingCapability(url, "filter");
  }

  const want = createWantRequest(
    commitOrRef,
    capabilities,
    nestLimit,
    "blob:none",
  );
  const result = await fetchPackfile(url, want);
  const commit = result.objects.get(commitOrRef)!;

  const rootTree = result.objects.get(
    utf8.decode(commit.data.slice(5, 45)) /* `tree <hash-hex-40-chars>` */,
  )!;

  return loadTree(rootTree, result.objects, nestLimit);
}

/**
 * Performs a shallow clone of a repository at a specific commit or reference.
 * @param url Base URL of the Git repository
 * @param commitOrRef Commit hash, branch name, or Git reference
 * @returns Promise resolving to a Tree object containing the repository structure
 */
export async function shallowCloneRepositoryAt(
  url: string,
  commitOrRef: string,
): Promise<{ commit: Commit; tree: Tree }> {
  let info: InfoRefsUploadPackResponse | undefined;
  if (commitOrRef.startsWith("refs/")) {
    info = await getInfoRefs(url);
    commitOrRef = info.refs[commitOrRef];
  }
  const caps = await getCapabilities(url, info);

  const capabilities: string[] = [];
  for (let i = 0; i < defaultCapabilities.length; i++) {
    const cap = defaultCapabilities[i];
    if (caps.includes(cap)) {
      capabilities.push(cap);
    }
  }
  for (let i = 0; i < necessaryCapabilities.length; i++) {
    const cap = necessaryCapabilities[i];
    if (caps.includes(cap)) {
      capabilities.push(cap);
    } else {
      throw new MissingCapability(url, cap);
    }
  }
  for (let i = 0; i < requiredCapabilities.length; i++) {
    const cap = requiredCapabilities[i];
    if (!caps.includes(cap)) {
      throw new MissingCapability(url, cap);
    }
  }

  const want = createWantRequest(commitOrRef, capabilities, 1);
  const result = await fetchPackfile(url, want);
  const commit = result.objects.get(commitOrRef)!;

  const rootTree = result.objects.get(
    utf8.decode(commit.data.slice(5, 45)) /* `tree <hash-hex-40-chars>` */,
  )!;

  return {
    tree: loadTree(rootTree, result.objects),
    commit: parseCommit(commit.data, commit.hash),
  };
}

/**
 * Fetches only the list of commits from a repository, excluding all files, blobs, and tree entries.
 * @param url Base URL of the Git repository
 * @param commitOrRef Commit hash, branch name, or Git reference to start from
 * @param maxCommits Optional maximum number of commits to fetch
 * @returns Promise resolving to an array of structured Commit objects
 * @throws MissingCapability if the server lacks the "filter" capability
 */
export async function fetchCommitsOnly(
  url: string,
  commitOrRef: string,
  maxCommits?: number,
): Promise<Commit[]> {
  let info: InfoRefsUploadPackResponse | undefined;
  if (commitOrRef.startsWith("refs/")) {
    info = await getInfoRefs(url);
    commitOrRef = info.refs[commitOrRef];
  }
  const caps = await getCapabilities(url, info);

  const capabilities: string[] = [];
  for (let i = 0; i < defaultCapabilities.length; i++) {
    const cap = defaultCapabilities[i];
    if (caps.includes(cap)) {
      capabilities.push(cap);
    }
  }
  for (let i = 0; i < necessaryCapabilities.length; i++) {
    const cap = necessaryCapabilities[i];
    if (caps.includes(cap)) {
      capabilities.push(cap);
    } else {
      throw new MissingCapability(url, cap);
    }
  }
  for (let i = 0; i < requiredCapabilities.length; i++) {
    const cap = requiredCapabilities[i];
    if (!caps.includes(cap)) {
      throw new MissingCapability(url, cap);
    }
  }
  if (caps.includes("filter")) {
    capabilities.push("filter");
  } else {
    throw new MissingCapability(url, "filter");
  }

  const want = createWantRequest(
    commitOrRef,
    capabilities,
    maxCommits,
    "tree:0",
  );
  const result = await fetchPackfile(url, want);

  // parse commit objects
  const commits: Commit[] = [];
  for (const [hash, obj] of result.objects) {
    const parsedCommit = parseCommit(obj.data, hash);
    commits.push(parsedCommit);
  }

  return commits;
}

/**
 * Fetches a single commit from a repository.
 * @param url Base URL of the Git repository
 * @param commitOrRef Commit hash, branch name, or Git reference to fetch
 * @returns Promise resolving to a structured Commit object
 * @throws MissingCapability if the server lacks the "filter" capability
 */
export async function getSingleCommit(
  url: string,
  commitOrRef: string,
): Promise<Commit> {
  const commits = await fetchCommitsOnly(url, commitOrRef, 1);
  if (commits.length === 0) {
    throw new Error(`No commit found for reference: ${commitOrRef}`);
  }
  return commits[0];
}

/**
 * Fetches a specific object (file or directory) from a repository by its path.
 * @param url Base URL of the Git repository
 * @param commitOrRef Commit hash, branch name, or Git reference to start from
 * @param path Path to the object within the repository
 * @returns Promise resolving to a TreeEntry if found, or undefined if not found
 * @throws MissingCapability if the server lacks the "filter" capability
 */
export async function getObjectByPath(
  url: string,
  commitOrRef: string,
  path: string,
): Promise<TreeEntry | undefined> {
  // normalize path and calculate the depth needed
  const normalizedPath = path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const pathSegments = normalizedPath === "" ? [] : normalizedPath.split("/");
  const requiredDepth = pathSegments.length;

  // get the directory tree with sufficient depth
  const tree = await getDirectoryTreeAt(url, commitOrRef, requiredDepth);

  // navigate through the tree to find the object
  let currentLevel = tree;
  nextSegment: for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i];
    const isLastSegment = i === pathSegments.length - 1;

    // first, check directories at this level
    for (const dir of currentLevel.directories) {
      if (dir.name === segment) {
        if (isLastSegment) {
          // found the target directory
          return {
            path: segment,
            mode: "40000",
            isDir: true,
            hash: dir.hash,
          };
        }
        // navigate deeper into the directory
        if (dir.content) {
          currentLevel = dir.content;
          continue nextSegment;
        } else {
          // directory content not loaded (path doesn't exist)
          return undefined;
        }
      }
    }

    // if not found in directories and it's the last segment, check files
    if (isLastSegment) {
      for (const file of currentLevel.files) {
        if (file.name === segment) {
          return {
            path: segment,
            mode: "100644",
            isDir: false,
            hash: file.hash,
          };
        }
      }
    }

    // segment not found at this level
    return undefined;
  }

  return undefined;
}
