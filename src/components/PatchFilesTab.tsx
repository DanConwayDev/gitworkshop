/**
 * PatchFilesTab — "Files Changed" view for patch-type PRs.
 *
 * Unlike PRFilesTab (which delegates to CommitDiffView for git-server-based
 * tree diffing), this component applies the patch chain's embedded diffs
 * sequentially to produce a combined diff. It works even when the git server
 * doesn't have the patch commits.
 *
 * Two-phase rendering (same UX as CommitDiffView):
 *   Phase 1 (fast): parse all patches to extract file-change metadata.
 *     Shows the file-tree sidebar immediately.
 *   Phase 2 (slower): fetch original file content from the git server and
 *     apply patches to generate the full combined diff.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
  AlertTriangle,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DiffView } from "@/components/DiffView";
import { fileDiffCardId } from "@/lib/diffCardId";
import { Skeleton } from "@/components/ui/skeleton";
import {
  computePatchFileChanges,
  mergePatchChainDiff,
} from "@/lib/patch-diff-merge";
import { eventIdToNevent } from "@/lib/routeUtils";
import type { Patch } from "@/casts/Patch";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
import type { FileChange } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PatchFilesTabProps {
  /** Ordered patches in the latest revision (oldest first). */
  chain: Patch[];
  /**
   * Base commit ID — from the first patch's `parent-commit` tag, or
   * approximated via the timestamp heuristic when the tag is absent.
   */
  baseCommitId: string | undefined;
  /**
   * True when `baseCommitId` was approximated via the timestamp heuristic
   * rather than read from the `parent-commit` tag. Used to soften the
   * warning message shown when the diff cannot be applied cleanly.
   */
  isBaseGuessed?: boolean;
  /** Pool instance from useGitPool (repo clone URLs). */
  pool: GitGraspPool | null;
  /** Called whenever the number of changed files becomes known. */
  onFileCountChange?: (count: number) => void;
  /**
   * Called once the patch apply phase completes (successfully or not).
   * Allows the parent to reflect the actual apply outcome in other tabs.
   */
  onApplyResult?: (result: {
    failedCount: number;
    failureReason?: "no-base" | "fetch-failed" | "hunk-mismatch";
  }) => void;
  /** Extra clone URLs to try for fetching original file content. */
  fallbackUrls?: string[];
  /**
   * Base path for the PR (e.g. `/user/repo/prs/nevent1...`).
   * When provided, patch event links in the failure banner point to
   * `<basePath>/commit/<nevent1>` instead of an external explorer.
   */
  basePath?: string;
  /**
   * Relay hints to embed in nevent1 identifiers for patch commit links.
   * Typically the repo relay group URLs.
   */
  relayHints?: string[];
}

// ---------------------------------------------------------------------------
// File tree sidebar (same structure as CommitDiffView)
// ---------------------------------------------------------------------------

interface TreeFile {
  kind: "file";
  name: string;
  path: string;
  status: FileChange["status"];
}

interface TreeDir {
  kind: "dir";
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
// Skeleton
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
// Phase state
// ---------------------------------------------------------------------------

type Phase =
  | { kind: "parsing" }
  | { kind: "applying"; changes: FileChange[] }
  | {
      kind: "done";
      changes: FileChange[];
      diff: string;
      failedCount: number;
      failureReason?: "no-base" | "fetch-failed" | "hunk-mismatch";
    }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PatchFilesTab({
  chain,
  baseCommitId,
  isBaseGuessed = false,
  pool,
  onFileCountChange,
  onApplyResult,
  fallbackUrls,
  basePath,
  relayHints,
}: PatchFilesTabProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "parsing" });
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleFileSelect = (path: string) => {
    setActiveFile(path);
    const el = document.getElementById(fileDiffCardId(path));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Notify parent when file count is known.
  useEffect(() => {
    if (
      (phase.kind === "applying" || phase.kind === "done") &&
      onFileCountChange
    ) {
      onFileCountChange(phase.changes.length);
    }
  }, [phase, onFileCountChange]);

  // Notify parent when the apply phase completes.
  useEffect(() => {
    if (phase.kind === "done" && onApplyResult) {
      onApplyResult({
        failedCount: phase.failedCount,
        failureReason: phase.failureReason,
      });
    }
  }, [phase, onApplyResult]);

  // Stable key for the chain to detect changes
  const chainKey = useMemo(() => chain.map((p) => p.id).join(","), [chain]);

  // Build commit detail links for the patch events (for the failure banner).
  // When basePath is provided, links point to the internal commit detail page.
  // Must be declared before any early returns to satisfy rules-of-hooks.
  const patchEventLinks = useMemo(() => {
    return chain.map((p, i) => {
      try {
        const nevent = eventIdToNevent(p.event.id, relayHints);
        const url = basePath ? `${basePath}/commit/${nevent}` : null;
        return { id: p.event.id, url, label: `patch ${i + 1}` };
      } catch {
        return { id: p.event.id, url: null, label: `patch ${i + 1}` };
      }
    });
  }, [chain, basePath, relayHints]);

  useEffect(() => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setPhase({ kind: "parsing" });

    async function run() {
      if (chain.length === 0) {
        setPhase({ kind: "done", changes: [], diff: "", failedCount: 0 });
        return;
      }

      // Phase 1: synchronous file-change extraction
      const changes = computePatchFileChanges(chain);

      if (abort.signal.aborted) return;

      setPhase({ kind: "applying", changes });

      if (changes.length === 0) {
        setPhase({ kind: "done", changes, diff: "", failedCount: 0 });
        return;
      }

      // Phase 2: fetch originals + apply patches
      const result = await mergePatchChainDiff(
        chain,
        // pool may be null if git server is unreachable — that's OK,
        // new-file-only patches don't need it
        pool!,
        baseCommitId,
        abort.signal,
        fallbackUrls,
      );

      if (abort.signal.aborted) return;

      setPhase({
        kind: "done",
        changes: result.fileChanges.length > 0 ? result.fileChanges : changes,
        diff: result.combinedDiff,
        failedCount: result.failedCount,
        failureReason: result.failureReason,
      });
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
  }, [chainKey, baseCommitId, pool, fallbackUrls?.join(",")]);

  // --- Render ---

  if (phase.kind === "parsing") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Parsing patches…</span>
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

  if (phase.kind === "applying") {
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
        No file changes in this patch set.
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {isBaseGuessed && phase.failedCount === 0 && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2.5 text-sm text-blue-700 dark:text-blue-400 mb-3">
          <div className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>
              Merge base approximated from patch timestamp — diff may differ
              slightly from the original.
            </span>
          </div>
        </div>
      )}
      {phase.failedCount > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 mb-3 space-y-2">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="space-y-1 min-w-0">
              <p>
                {phase.failureReason === "no-base" && (
                  <>
                    {phase.failedCount} file{phase.failedCount !== 1 ? "s" : ""}{" "}
                    could not be applied — the patch is missing a{" "}
                    <code className="rounded bg-amber-500/10 px-1 font-mono text-[11px]">
                      parent-commit
                    </code>{" "}
                    tag and no base commit could be determined.
                  </>
                )}
                {phase.failureReason === "fetch-failed" && (
                  <>
                    {phase.failedCount} file{phase.failedCount !== 1 ? "s" : ""}{" "}
                    could not be applied — the base file content could not be
                    fetched from the git server (the patch may reference a
                    commit not yet pushed).
                  </>
                )}
                {phase.failureReason === "hunk-mismatch" && (
                  <>
                    {phase.failedCount} file{phase.failedCount !== 1 ? "s" : ""}{" "}
                    could not be applied —
                    {isBaseGuessed
                      ? " the base commit was approximated from the patch timestamp and the patch did not apply cleanly against it."
                      : " the patch did not apply cleanly against the current branch head."}
                  </>
                )}
                {!phase.failureReason && (
                  <>
                    {phase.failedCount} file{phase.failedCount !== 1 ? "s" : ""}{" "}
                    could not be applied.
                  </>
                )}{" "}
                {phase.failedCount === phase.changes.length
                  ? "Showing the original patch diff for all files."
                  : `The remaining ${phase.changes.length - phase.failedCount} file${phase.changes.length - phase.failedCount !== 1 ? "s" : ""} show the applied combined diff.`}
              </p>
              {patchEventLinks.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                  <span className="text-xs text-amber-600/70 dark:text-amber-400/70">
                    View patch commit
                    {patchEventLinks.length !== 1 ? "s" : ""}:
                  </span>
                  {patchEventLinks.map((link) =>
                    link.url ? (
                      <Link
                        key={link.id}
                        to={link.url}
                        className="inline-flex items-center gap-1 text-xs text-amber-600/80 dark:text-amber-400/80 hover:text-amber-700 dark:hover:text-amber-300 underline underline-offset-2"
                      >
                        {link.label}
                      </Link>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
    </div>
  );
}
