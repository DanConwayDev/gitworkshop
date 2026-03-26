/**
 * CommitDiffView — reusable two-phase diff viewer with file-tree sidebar.
 *
 * Phase 1 (fast): fetches both commit trees (blob:none) and diffs them to
 *   produce a FileChange list. Shows a file-change summary immediately.
 *
 * Phase 2 (slower): fetches the changed blobs and generates the full unified
 *   diff string, then hands it to DiffView for rendering.
 *
 * Used by:
 *   - PRFilesTab   (tip vs merge-base)
 *   - RepoCommitPage  (commit vs its first parent)
 *   - PRCommitPage    (commit vs its first parent)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileDiff,
  FilePlus2,
  FileX2,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DiffView } from "@/components/DiffView";
import { fileDiffCardId } from "@/lib/diffCardId";
import { Skeleton } from "@/components/ui/skeleton";
import {
  diffTrees,
  generateUnifiedDiff,
  type FileChange,
} from "@/lib/git-grasp-pool";
import type { GitGraspPool } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CommitDiffViewProps {
  /** Tip commit ID (the newer commit). */
  tipCommitId: string;
  /** Base commit ID (the older commit / parent). */
  baseCommitId: string;
  /** Pool instance from useGitPool (repo clone URLs). */
  pool: GitGraspPool;
  /** Called whenever the number of changed files becomes known. */
  onFileCountChange?: (count: number) => void;
  /**
   * Extra URLs to try after the pool's own URLs if commit/blob data is not
   * found there. Not tracked by the pool. Used to pass PR/PR-Update clone
   * URLs when viewing a PR's file diff.
   */
  fallbackUrls?: string[];
}

// ---------------------------------------------------------------------------
// File tree data structure + sidebar
// ---------------------------------------------------------------------------

interface TreeFile {
  kind: "file";
  name: string;
  path: string;
  status: FileChange["status"];
}

interface TreeDir {
  kind: "dir";
  /** Display label — may be "src/lib" after collapsing single-child dirs */
  label: string;
  name: string;
  children: TreeNode[];
}

type TreeNode = TreeFile | TreeDir;

function insertNode(
  map: Map<string, TreeNode>,
  parts: string[],
  depth: number,
  change: FileChange,
): void {
  const name = parts[depth];
  if (depth === parts.length - 1) {
    map.set(name, {
      kind: "file",
      name,
      path: change.path,
      status: change.status,
    });
    return;
  }
  let dir = map.get(name);
  if (!dir || dir.kind !== "dir") {
    dir = { kind: "dir", name, label: name, children: [] };
    map.set(name, dir);
  }
  const childMap = new Map((dir as TreeDir).children.map((c) => [c.name, c]));
  insertNode(childMap, parts, depth + 1, change);
  (dir as TreeDir).children = Array.from(childMap.values());
}

/** Collapse single-child directory chains into a combined label, e.g. "src/lib". */
function collapseTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "file") return node;
    const collapsed: TreeDir = {
      ...node,
      children: collapseTree(node.children),
    };
    if (
      collapsed.children.length === 1 &&
      collapsed.children[0].kind === "dir"
    ) {
      const child = collapsed.children[0] as TreeDir;
      return {
        ...child,
        label: `${collapsed.label}/${child.label}`,
        name: `${collapsed.name}/${child.name}`,
      };
    }
    return collapsed;
  });
}

function buildTree(changes: FileChange[]): TreeNode[] {
  const root = new Map<string, TreeNode>();
  for (const change of changes) {
    insertNode(root, change.path.split("/"), 0, change);
  }
  return collapseTree(Array.from(root.values()));
}

function SidebarFileIcon({ status }: { status: FileChange["status"] }) {
  if (status === "added")
    return <FilePlus2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  if (status === "deleted")
    return <FileX2 className="h-3.5 w-3.5 text-red-500 shrink-0" />;
  return <FileDiff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

function TreeNodeRow({
  node,
  depth,
  activeFile,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const indent = depth * 10;

  if (node.kind === "file") {
    const isActive = activeFile === node.path;
    return (
      <button
        onClick={() => onSelect(node.path)}
        title={node.path}
        style={{ paddingLeft: `${6 + indent}px` }}
        className={cn(
          "flex items-center gap-1.5 w-full text-left py-[3px] pr-2 rounded text-xs",
          "hover:bg-muted/60 transition-colors",
          isActive && "bg-accent text-accent-foreground",
        )}
      >
        <SidebarFileIcon status={node.status} />
        <span className="truncate min-w-0">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: `${6 + indent}px` }}
        className="flex items-center gap-1.5 w-full text-left py-[3px] pr-2 rounded text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        {open ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500/80" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500/80" />
        )}
        <span className="truncate min-w-0">{node.label}</span>
      </button>
      {open &&
        node.children.map((child) => (
          <TreeNodeRow
            key={child.name}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

function FileTreeSidebar({
  changes,
  activeFile,
  onSelect,
  loading,
}: {
  changes: FileChange[];
  activeFile: string | null;
  onSelect: (path: string) => void;
  loading?: boolean;
}) {
  const tree = useMemo(() => buildTree(changes), [changes]);

  return (
    <div className="hidden lg:flex flex-col w-56 shrink-0 border-r border-border/40 sticky top-14 self-start max-h-[calc(100vh-3.5rem)] overflow-hidden">
      <div className="px-2 py-1.5 border-b border-border/40 flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
        <span className="font-medium text-foreground">{changes.length}</span>
        <span>{changes.length === 1 ? "file" : "files"} changed</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin ml-auto" />}
      </div>
      <div className="overflow-y-auto flex-1 py-1 px-1">
        {tree.map((node) => (
          <TreeNodeRow
            key={node.name}
            node={node}
            depth={0}
            activeFile={activeFile}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 1: file list skeleton (shown while trees are being fetched)
// ---------------------------------------------------------------------------

function FileListSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-1.5">
          <Skeleton className="h-3.5 w-3.5 rounded" />
          <Skeleton className="h-3.5 w-3.5 rounded" />
          <Skeleton
            className={cn(
              "h-3.5 rounded",
              i % 3 === 0 ? "w-48" : i % 3 === 1 ? "w-64" : "w-40",
            )}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Phase =
  | { kind: "loading-trees" }
  | { kind: "loading-diff"; changes: FileChange[] }
  | { kind: "done"; changes: FileChange[]; diff: string }
  | { kind: "error"; message: string };

export function CommitDiffView({
  tipCommitId,
  baseCommitId,
  pool,
  onFileCountChange,
  fallbackUrls,
}: CommitDiffViewProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading-trees" });
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleFileSelect = (path: string) => {
    setActiveFile(path);
    const el = document.getElementById(fileDiffCardId(path));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Notify parent when file count is known (phase 1 complete).
  useEffect(() => {
    if (
      (phase.kind === "loading-diff" || phase.kind === "done") &&
      onFileCountChange
    ) {
      onFileCountChange(phase.changes.length);
    }
  }, [phase, onFileCountChange]);

  useEffect(() => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setPhase({ kind: "loading-trees" });

    async function run() {
      // --- Phase 1: fetch both trees and diff them ---
      const range = await pool.getCommitRange(
        tipCommitId,
        baseCommitId,
        abort.signal,
        fallbackUrls,
      );

      if (abort.signal.aborted) return;

      if (!range) {
        setPhase({
          kind: "error",
          message:
            "Could not fetch commit data. The git server may not have these commits.",
        });
        return;
      }

      const changes = diffTrees(range.tipTree, range.baseTree);

      setPhase({ kind: "loading-diff", changes });

      if (changes.length === 0) {
        setPhase({ kind: "done", changes, diff: "" });
        return;
      }

      // --- Phase 2: fetch blobs and generate unified diff ---
      // Pass a stable cacheKey so repeated renders (e.g. tab switches) are
      // instant — the diff string is returned from the module-level cache
      // without re-fetching blobs or re-running the generation loop.
      const diff = await generateUnifiedDiff(
        changes,
        pool,
        abort.signal,
        fallbackUrls,
        `${tipCommitId}:${baseCommitId}`,
      );

      if (abort.signal.aborted) return;

      setPhase({ kind: "done", changes, diff });
    }

    run().catch((err) => {
      if (abort.signal.aborted) return;
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    });

    return () => {
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipCommitId, baseCommitId, pool, fallbackUrls?.join(",")]);

  // --- Render ---

  if (phase.kind === "loading-trees") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Fetching file tree…</span>
        </div>
        <FileListSkeleton />
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{phase.message}</span>
      </div>
    );
  }

  if (phase.kind === "loading-diff") {
    return (
      <div className="flex gap-0 rounded-lg border border-border/60 min-w-0">
        <FileTreeSidebar
          changes={phase.changes}
          activeFile={activeFile}
          onSelect={handleFileSelect}
          loading
        />
        <div className="flex-1 min-w-0 p-3 overflow-hidden">
          <DiffView diff="" loadingFiles={phase.changes} />
        </div>
      </div>
    );
  }

  // phase.kind === "done"
  if (phase.changes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
        No file changes between these two commits.
      </div>
    );
  }

  return (
    <div className="flex gap-0 rounded-lg border border-border/60 min-w-0">
      <FileTreeSidebar
        changes={phase.changes}
        activeFile={activeFile}
        onSelect={handleFileSelect}
      />
      <div className="flex-1 min-w-0 p-3 overflow-hidden">
        <DiffView diff={phase.diff} expandedFile={activeFile} />
      </div>
    </div>
  );
}
