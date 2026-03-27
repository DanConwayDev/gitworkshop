/**
 * create-repo — pure functions for creating a new git repository.
 *
 * Handles:
 *   1. Repo identifier (d-tag) validation and slug generation
 *   2. Initial commit creation: blob (README.md) → tree → commit (no parents)
 *   3. Packfile construction for the initial commit
 *
 * All functions are pure and async (SHA-1 hashing uses crypto.subtle).
 * No Nostr, no React, no side effects.
 */

import type { CommitPerson, CommitData } from "@/lib/git-objects";
import {
  packBlob,
  packTree,
  packCommit,
  createPackfile,
  type PackableObject,
} from "@/lib/git-packfile";

// ---------------------------------------------------------------------------
// Slug / identifier validation
// ---------------------------------------------------------------------------

/**
 * Derive a repository identifier (d-tag) from a human-readable name.
 *
 * Matches the algorithm used by ngit CLI (`identifier_from_name`):
 *   - Spaces → hyphens
 *   - Non-ASCII-alphanumeric characters (except `/`) → hyphens
 *   - Case is preserved (NOT lowercased)
 *   - Consecutive hyphens are NOT collapsed
 *   - Forward slashes are preserved
 *
 * @see ngit/src/bin/ngit/sub_commands/init.rs `identifier_from_name`
 */
export function toRepoIdentifier(name: string): string {
  return name
    .replace(/ /g, "-")
    .split("")
    .map((c) => {
      if (/[a-zA-Z0-9/]/.test(c)) return c;
      return "-";
    })
    .join("");
}

/**
 * Validate a repo identifier (d-tag).
 * Returns an error message or undefined if valid.
 */
export function validateRepoIdentifier(identifier: string): string | undefined {
  if (identifier.length === 0) return "Repository name is required";
  if (identifier.length > 100)
    return "Identifier must be 100 characters or fewer";
  // Must contain at least one alphanumeric character
  if (!/[a-zA-Z0-9]/.test(identifier))
    return "Identifier must contain at least one alphanumeric character";
  return undefined;
}

// ---------------------------------------------------------------------------
// Initial commit creation
// ---------------------------------------------------------------------------

/** Input for creating the initial commit. */
export interface InitialCommitInput {
  /** Human-readable repo name (used in README heading) */
  repoName: string;
  /** Optional description (appended to README) */
  description?: string;
  /** Display name for the git author/committer */
  authorName: string;
  /** The user's npub (used in the noreply email) */
  npub: string;
  /** Unix timestamp in seconds (defaults to now) */
  timestamp?: number;
}

/** Result of creating the initial commit. */
export interface InitialCommitResult {
  /** The SHA-1 hash of the root commit */
  commitHash: string;
  /** The packfile bytes ready for pushing */
  packfile: Uint8Array;
  /** The individual packable objects (blob, tree, commit) */
  objects: PackableObject[];
}

/**
 * Build the README.md content for a new repository.
 */
export function buildReadmeContent(
  repoName: string,
  description?: string,
): string {
  let content = `# ${repoName}\n`;
  if (description) {
    content += `\n${description}\n`;
  }
  return content;
}

/**
 * Create the initial commit for a new repository.
 *
 * Produces a root commit (no parents) containing a single README.md file.
 * Returns the commit hash and a packfile containing all three objects
 * (blob, tree, commit).
 *
 * The author and committer are the same person, using UTC (+0000) timezone
 * for deterministic hashing.
 */
export async function createInitialCommit(
  input: InitialCommitInput,
): Promise<InitialCommitResult> {
  const encoder = new TextEncoder();
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);

  // 1. Create blob (README.md content)
  const readmeContent = buildReadmeContent(input.repoName, input.description);
  const blobObj = await packBlob(encoder.encode(readmeContent));

  // 2. Create tree (single entry: README.md)
  const treeObj = await packTree([
    { mode: "100644", name: "README.md", hash: blobObj.hash },
  ]);

  // 3. Create commit (root — no parents)
  const person: CommitPerson = {
    name: input.authorName,
    email: `${input.npub}@nostr.noreply`,
    timestamp,
    timezone: "+0000",
  };

  const commitData: CommitData = {
    treeHash: treeObj.hash,
    parentHashes: [],
    author: person,
    committer: person,
    message: "Initial commit",
  };

  const commitObj = await packCommit(commitData);

  // 4. Create packfile
  const objects = [blobObj, treeObj, commitObj];
  const packfile = await createPackfile(objects);

  return {
    commitHash: commitObj.hash,
    packfile,
    objects,
  };
}
