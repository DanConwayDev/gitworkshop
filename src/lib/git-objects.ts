/**
 * git-objects — create and hash git objects (blob, tree, commit).
 *
 * Git objects are content-addressed: the SHA-1 hash of the serialized object
 * (with a type+size header) is the object ID. This module provides functions
 * to serialize and hash each object type, matching git's exact binary format.
 *
 * Uses crypto.subtle.digest("SHA-1", ...) which is available in all modern
 * browsers and in Node 15+.
 *
 * These functions are the foundation for:
 *   - Blob hash verification (Phase 1 — already used in patch-diff-merge.ts)
 *   - Full commit hash verification (Phase 2)
 *   - Creating real git objects for merge commits and push (Phase 3)
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/**
 * Compute the SHA-1 hash of arbitrary data, returned as a lowercase hex string.
 */
export async function sha1hex(data: Uint8Array): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hashBuffer = await crypto.subtle.digest("SHA-1", data as any);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Wrap content with a git object header: `<type> <size>\0<content>`.
 */
export function gitObjectBytes(type: string, content: Uint8Array): Uint8Array {
  const header = encoder.encode(`${type} ${content.length}\0`);
  const full = new Uint8Array(header.length + content.length);
  full.set(header);
  full.set(content, header.length);
  return full;
}

// ---------------------------------------------------------------------------
// Blob
// ---------------------------------------------------------------------------

/**
 * Compute the git blob hash for the given content.
 *
 * Git blob format: `blob <size>\0<content>`
 * The hash is SHA-1 of the full object bytes.
 *
 * @param content - Raw file content as bytes
 * @returns 40-character lowercase hex SHA-1 hash
 */
export async function gitBlobHash(content: Uint8Array): Promise<string> {
  return sha1hex(gitObjectBytes("blob", content));
}

/**
 * Convenience: compute the git blob hash for a UTF-8 string.
 */
export async function gitBlobHashFromString(content: string): Promise<string> {
  return gitBlobHash(encoder.encode(content));
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

/**
 * A single entry in a git tree object.
 *
 * mode: file mode string, e.g. "100644" (regular file), "100755" (executable),
 *       "40000" (directory — note: 5 digits, not 6), "120000" (symlink),
 *       "160000" (gitlink/submodule).
 * name: filename (no path separators).
 * hash: 40-character hex SHA-1 of the referenced object (blob or tree).
 */
export interface TreeEntry {
  mode: string;
  name: string;
  hash: string;
}

/**
 * Convert a 40-character hex hash to a 20-byte Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Sort tree entries using git's sorting rules.
 *
 * Git sorts tree entries as if directory names have a trailing `/` appended.
 * This means:
 *   - "foo" (file) sorts before "foo.c" (file)
 *   - "foo" (directory, treated as "foo/") sorts after "foo.c" (file)
 *
 * The mode determines whether an entry is a directory: modes starting with
 * "40" are directories (trees).
 */
function sortTreeEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    const aName = a.mode.startsWith("40") ? a.name + "/" : a.name;
    const bName = b.mode.startsWith("40") ? b.name + "/" : b.name;
    // Byte-level comparison (ASCII)
    if (aName < bName) return -1;
    if (aName > bName) return 1;
    return 0;
  });
}

/**
 * Serialize a git tree object to its binary format.
 *
 * Tree format (no header — just the content portion):
 *   For each entry: `<mode> <name>\0<20-byte-binary-hash>`
 *
 * Entries are sorted using git's directory-aware sorting rules.
 *
 * @param entries - Tree entries (will be sorted internally)
 * @returns The serialized tree content (without the `tree <size>\0` header)
 */
export function serializeTreeContent(entries: TreeEntry[]): Uint8Array {
  const sorted = sortTreeEntries(entries);

  // Calculate total size
  let totalSize = 0;
  const parts: { header: Uint8Array; hash: Uint8Array }[] = [];

  for (const entry of sorted) {
    const header = encoder.encode(`${entry.mode} ${entry.name}\0`);
    const hash = hexToBytes(entry.hash);
    parts.push({ header, hash });
    totalSize += header.length + hash.length;
  }

  // Build the content
  const content = new Uint8Array(totalSize);
  let offset = 0;
  for (const { header, hash } of parts) {
    content.set(header, offset);
    offset += header.length;
    content.set(hash, offset);
    offset += hash.length;
  }

  return content;
}

/**
 * Compute the git tree hash for the given entries.
 *
 * @param entries - Tree entries (will be sorted internally)
 * @returns 40-character lowercase hex SHA-1 hash
 */
export async function gitTreeHash(entries: TreeEntry[]): Promise<string> {
  const content = serializeTreeContent(entries);
  return sha1hex(gitObjectBytes("tree", content));
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/**
 * Author/committer identity for a git commit object.
 */
export interface CommitPerson {
  name: string;
  email: string;
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Timezone in git format: "+HHMM" or "-HHMM" */
  timezone: string;
}

/**
 * Options for serializing a git commit object.
 */
export interface CommitData {
  /** SHA-1 hash of the tree object */
  treeHash: string;
  /** SHA-1 hashes of parent commits (empty for root commits, 2+ for merges) */
  parentHashes: string[];
  /** Author identity */
  author: CommitPerson;
  /** Committer identity */
  committer: CommitPerson;
  /** Full commit message (subject + body). A trailing newline is added if absent. */
  message: string;
  /**
   * Optional GPG/SSH signature. When present, it's included as a `gpgsig`
   * header in the commit object. The signature string should be the raw
   * PEM-encoded signature (e.g. "-----BEGIN PGP SIGNATURE-----\n...").
   *
   * Git formats this as:
   *   gpgsig -----BEGIN PGP SIGNATURE-----
   *    <base64 line>
   *    ...
   *    -----END PGP SIGNATURE-----
   *
   * Note: continuation lines are indented with a single space.
   */
  gpgSignature?: string;
}

/**
 * Format a person line for a git commit object.
 * Format: `<name> <<email>> <timestamp> <timezone>`
 */
function formatPersonLine(person: CommitPerson): string {
  return `${person.name} <${person.email}> ${person.timestamp} ${person.timezone}`;
}

/**
 * Format a GPG signature for inclusion in a git commit object.
 *
 * The signature is stored as a multi-line header where continuation lines
 * are indented with a single space character.
 */
function formatGpgSignature(signature: string): string {
  const lines = signature.split("\n");
  // First line goes on the same line as "gpgsig "
  // Subsequent lines are indented with a single space
  return (
    "gpgsig " +
    lines[0] +
    "\n" +
    lines
      .slice(1)
      .map((line) => " " + line)
      .join("\n")
  );
}

/**
 * Serialize a git commit object to its content bytes (without the header).
 *
 * Commit format:
 *   tree <tree-hash>\n
 *   parent <parent-hash>\n        (repeated for each parent)
 *   author <name> <<email>> <timestamp> <tz>\n
 *   committer <name> <<email>> <timestamp> <tz>\n
 *   [gpgsig <signature>]\n        (optional, with space-indented continuation)
 *   \n
 *   <message>\n
 */
export function serializeCommitContent(data: CommitData): Uint8Array {
  let content = `tree ${data.treeHash}\n`;

  for (const parent of data.parentHashes) {
    content += `parent ${parent}\n`;
  }

  content += `author ${formatPersonLine(data.author)}\n`;
  content += `committer ${formatPersonLine(data.committer)}\n`;

  if (data.gpgSignature) {
    content += formatGpgSignature(data.gpgSignature) + "\n";
  }

  content += "\n";

  // Ensure message ends with exactly one newline
  const msg = data.message.endsWith("\n") ? data.message : data.message + "\n";
  content += msg;

  return encoder.encode(content);
}

/**
 * Compute the git commit hash for the given commit data.
 *
 * @returns 40-character lowercase hex SHA-1 hash
 */
export async function gitCommitHash(data: CommitData): Promise<string> {
  const content = serializeCommitContent(data);
  return sha1hex(gitObjectBytes("commit", content));
}
