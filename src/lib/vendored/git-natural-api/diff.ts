/**
 * Vendored from @fiatjaf/git-natural-api v0.2.4
 * https://jsr.io/@fiatjaf/git-natural-api
 */

import { getObject, getSingleCommit } from "./index.ts";
import { parseTree, type TreeEntry } from "./tree.ts";

export type DiffFile = {
  path: string;
} & (
  | {
      status: "changed";
      lines: DiffLine[];
    }
  | {
      status: "changed-binary";
    }
  | {
      status: "deleted" | "added";
      content: Uint8Array;
    }
);

export type DiffLine = {
  index: number;
  status: "deleted" | "added" | "changed";
  text: string;
};

export async function getCommitDiff(
  url: string,
  commitOrRef: string,
): Promise<DiffFile[]> {
  const commit = await getSingleCommit(url, commitOrRef);

  const added = new Map<string, TreeEntry>();
  const deleted = new Map<string, TreeEntry>();
  const changed = new Map<
    string,
    [newVersion: TreeEntry, oldVersions: TreeEntry[]]
  >();
  const unchanged = new Set<string>();

  await Promise.all(
    commit.parents.map(async (parent) =>
      computeTreeDiffs(
        url,
        commit.tree,
        await getSingleCommit(url, parent).then(
          (parentCommit) => parentCommit.tree,
        ),
        "",
        added,
        deleted,
        changed,
        unchanged,
      ),
    ),
  );

  const diff: DiffFile[] = [];
  const p: Promise<void>[] = [];

  for (const [path, [curr, olds]] of changed.entries()) {
    const currFetch = getObject(url, curr.hash);
    const oldFetches = olds.map((o) => getObject(url, o.hash));
    const fetches = [currFetch, ...oldFetches];
    p.push(
      Promise.all(fetches).then(([curr, ...olds]) => {
        const old = olds[0];
        if (!curr || !old) return;
        if (isBinary(curr.data) || isBinary(old.data)) {
          diff.push({
            path,
            status: "changed-binary",
          });
          return;
        }

        diff.push({
          path,
          status: "changed",
          lines: diffTextLines(old.data, curr.data),
        });
      }),
    );
  }
  for (const [path, old] of deleted.entries()) {
    p.push(
      getObject(url, old.hash).then((o) => {
        diff.push({
          path,
          status: "deleted",
          content: o!.data,
        });
      }),
    );
  }
  for (const [path, curr] of added.entries()) {
    p.push(
      getObject(url, curr.hash).then((o) => {
        diff.push({
          path,
          status: "added",
          content: o!.data,
        });
      }),
    );
  }

  await Promise.all(p);

  return diff;
}

async function computeTreeDiffs(
  url: string,
  tree: string | null,
  parentTree: string | null,
  basePath: string,
  added: Map<string, TreeEntry>,
  deleted: Map<string, TreeEntry>,
  changed: Map<string, [newVersion: TreeEntry, oldVersions: TreeEntry[]]>,
  unchanged: Set<string>,
) {
  const treeP = tree
    ? getObject(url, tree).then((o) => parseTree(o!.data))
    : [];
  const oldTree = parentTree
    ? await getObject(url, parentTree).then((o) => parseTree(o!.data))
    : [];
  const newTree = await treeP;

  for (const entry of newTree) {
    const old = oldTree.find((e) => e.path === entry.path);
    if (old) {
      // if this was previously assumed to be a new file, think again
      added.delete(basePath + entry.path);

      if (old.hash === entry.hash) {
        // nothing changed
        unchanged.add(basePath + entry.path);
      } else {
        if (entry.isDir) {
          // recurse into dir
          await computeTreeDiffs(
            url,
            entry.hash,
            old.hash,
            basePath + entry.path + "/",
            added,
            deleted,
            changed,
            unchanged,
          );
        } else {
          if (!changed.has(basePath + entry.path)) {
            changed.set(basePath + entry.path, [entry, [old]]);
          } else changed.get(basePath + entry.path)![1].push(old);
        }
      }
    } else {
      // no old, means this is a new file or directory
      if (entry.isDir) {
        // when it's a directory recurse into it, adding all files below
        await computeTreeDiffs(
          url,
          entry.hash,
          null,
          basePath + entry.path + "/",
          added,
          deleted,
          changed,
          unchanged,
        );
      } else added.set(basePath + entry.path, entry);
    }
  }

  for (const old of oldTree) {
    if (unchanged.has(basePath + old.path) || changed.has(basePath + old.path))
      continue;

    // old path not found in new
    if (old.isDir) {
      // when it's a directory recurse into it, deleting all files below
      await computeTreeDiffs(
        url,
        null,
        old.hash,
        basePath + old.path + "/",
        added,
        deleted,
        changed,
        unchanged,
      );
    } else {
      deleted.set(basePath + old.path, old);
    }
  }
}

function isBinary(data: Uint8Array): boolean {
  for (const byte of data) {
    if (byte === 0) return true;
  }
  return false;
}

function diffTextLines(oldData: Uint8Array, newData: Uint8Array): DiffLine[] {
  const decoder = new TextDecoder();
  const oldText = decoder.decode(oldData);
  const newText = decoder.decode(newData);
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  const ops = lcsOperations(oldLines, newLines);
  const allLines: DiffLine[] = [];
  let oldIndex = 1;
  let newIndex = 1;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const next = ops[i + 1];

    if (op.type === "del" && next?.type === "add") {
      allLines.push({
        status: "changed",
        index: newIndex,
        text: next.line,
      });
      oldIndex++;
      newIndex++;
      i++;
      continue;
    }

    if (op.type === "add" && next?.type === "del") {
      allLines.push({
        status: "changed",
        index: newIndex,
        text: op.line,
      });
      oldIndex++;
      newIndex++;
      i++;
      continue;
    }

    if (op.type === "add") {
      allLines.push({
        status: "added",
        index: newIndex,
        text: op.line,
      });
      newIndex++;
      continue;
    }

    if (op.type === "del") {
      allLines.push({
        status: "deleted",
        index: oldIndex,
        text: op.line,
      });
      oldIndex++;
      continue;
    }

    oldIndex++;
    newIndex++;
  }

  if (allLines.length === 0) return allLines;

  const keep = new Array(allLines.length).fill(false);
  for (let i = 0; i < allLines.length; i++) {
    const start = Math.max(0, i - 3);
    const end = Math.min(allLines.length - 1, i + 3);
    for (let j = start; j <= end; j++) keep[j] = true;
  }

  return allLines.filter((_, i) => keep[i]);
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

type LcsOp =
  | { type: "equal"; line: string }
  | { type: "add"; line: string }
  | { type: "del"; line: string };

function lcsOperations(oldLines: string[], newLines: string[]): LcsOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  const dp: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
      }
    }
  }

  const ops: LcsOp[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: "equal", line: oldLines[i - 1] });
      i--;
      j--;
      continue;
    }

    if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) {
      ops.push({ type: "del", line: oldLines[i - 1] });
      i--;
      continue;
    }

    if (j > 0) {
      ops.push({ type: "add", line: newLines[j - 1] });
      j--;
    }
  }

  ops.reverse();
  return ops;
}
