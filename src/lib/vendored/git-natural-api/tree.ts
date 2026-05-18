/**
 * Vendored from @fiatjaf/git-natural-api v0.2.4
 * https://jsr.io/@fiatjaf/git-natural-api
 *
 * Local modifications (already applied):
 *  - Added `mode` field to Tree directory and file entries
 */

import type { ObjectGetterByHash, ParsedObject } from "./parse-packfile.ts";

/** Represents a single entry in a Git tree */
export type TreeEntry = {
  path: string; // File or directory path
  mode: string; // Unix file mode (e.g., "100644", "40000")
  isDir: boolean; // True if this is a directory
  hash: string; // SHA-1 hash of the object
};

/** Represents a parsed Git tree with hierarchical structure */
export type Tree = {
  directories: Array<{
    name: string;
    hash: string;
    /** Unix file mode for the directory entry (e.g., "40000") */
    mode: string;
    content: null | Tree; // Nested tree structure
  }>;
  files: Array<{
    name: string;
    hash: string;
    /**
     * Unix file mode (e.g., "100644" regular, "100755" executable,
     * "120000" symlink, "160000" gitlink/submodule)
     */
    mode: string;
    content: null | Uint8Array; // File content
  }>;
};

/**
 * Loads and parses a tree object into a hierarchical structure.
 * @param obj Parsed Git tree object
 * @param objects Object getter function to retrieve referenced objects
 * @param depth Optional depth limit for recursive tree loading (0 = no limit)
 * @returns Hierarchical tree structure with files and directories
 */
export function loadTree(
  obj: ParsedObject,
  objects: ObjectGetterByHash,
  depth?: number,
): Tree {
  const directories: Tree["directories"] = [];
  const files: Tree["files"] = [];
  const entries = parseTree(obj.data);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const obj = objects.get(entry.hash);

    if (entry.isDir) {
      directories.push({
        name: entry.path,
        hash: entry.hash,
        mode: entry.mode,
        content:
          obj && (depth === undefined || depth > 0)
            ? loadTree(
                obj,
                objects,
                depth !== undefined ? depth - 1 : undefined,
              )
            : null,
      });
    } else {
      files.push({
        name: entry.path,
        hash: entry.hash,
        mode: entry.mode,
        content: obj ? obj.data : null,
      });
    }
  }

  return { directories, files };
}

/**
 * Parses raw Git tree data into an array of tree entries.
 * Tree format: each entry: <mode><space><filename><null><20-byte SHA-1>
 * @param treeData Raw byte data of a Git tree object
 * @returns Array of TreeEntry objects representing files and directories
 */
export function parseTree(treeData: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let offset = 0;

  while (offset < treeData.length) {
    // read mode (ASCII digits until space)
    let modeEnd = offset;
    while (treeData[modeEnd] !== 0x20) {
      // space
      modeEnd++;
    }
    const mode = new TextDecoder().decode(treeData.slice(offset, modeEnd));
    offset = modeEnd + 1; // skip space

    // read filename (until null byte)
    let filenameEnd = offset;
    while (treeData[filenameEnd] !== 0x00) {
      // null
      filenameEnd++;
    }
    const path = new TextDecoder().decode(treeData.slice(offset, filenameEnd));
    offset = filenameEnd + 1; // skip null

    // read 20-byte SHA-1 hash
    const hashBytes = treeData.slice(offset, offset + 20);
    const hash = Array.from(hashBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    offset += 20;

    // determine if this is a tree (directory) or blob (file)
    // mode 040000 or 40000 = tree/directory
    const isDir = mode === "40000" || mode === "040000";

    entries.push({ mode, path, hash, isDir });
  }

  return entries;
}
