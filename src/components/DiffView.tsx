/**
 * DiffView — renders a unified diff with syntax highlighting and line numbers.
 *
 * Parses a unified diff string (from git format-patch or git diff) using
 * parse-diff, then highlights each line with shiki. Renders a GitHub-style
 * unified diff with:
 *   - Old/new line number gutters
 *   - +/- indicator column
 *   - Syntax-highlighted code
 *   - Collapsible file sections
 *   - Hunk headers
 *
 * Each line is a discrete DOM element with data-line-old / data-line-new
 * attributes for future line-level commenting.
 */

import { memo, useEffect, useRef, useState, useMemo, useCallback } from "react";
import parseDiff from "parse-diff";
import { SyncedScrollArea } from "@/components/SyncedScrollArea";
import {
  getHighlighter,
  langFromFilename,
  type ThemedToken,
} from "@/lib/highlighter";
import type { Highlighter, BundledLanguage } from "shiki";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileX2,
  FileDiff,
  Plus,
  Minus,
  AlertTriangle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Theme hook — detect dark mode (same as CodeBlock)
// ---------------------------------------------------------------------------

function useIsDark(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return dark;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffViewProps {
  /** Raw unified diff string */
  diff: string;
  /** Extra class on the outer wrapper */
  className?: string;
  /** Whether files start collapsed (default true) */
  defaultCollapsed?: boolean;
  /**
   * When set, the FileDiffCard for this path is forced open and scrolled into
   * view. Pass the repo-root-relative path (e.g. "src/lib/foo.ts").
   */
  expandedFile?: string | null;
}

/** Stable DOM id for a file's diff card — used for scroll targeting. */
export function fileDiffCardId(filename: string): string {
  return "diff-" + filename.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ---------------------------------------------------------------------------
// Highlighter hook
// ---------------------------------------------------------------------------

function useHighlighter(): Highlighter | null {
  const [hl, setHl] = useState<Highlighter | null>(null);
  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((h) => {
      if (!cancelled) setHl(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return hl;
}

// ---------------------------------------------------------------------------
// Token cache — highlight all lines for a file in one pass
// ---------------------------------------------------------------------------

type TokenMap = Map<string, ThemedToken[]>;

async function tokenizeLines(
  hl: Highlighter,
  lines: string[],
  lang: BundledLanguage | "text",
  theme: string,
): Promise<TokenMap> {
  const map: TokenMap = new Map();
  if (lines.length === 0) return map;

  // Ensure language is loaded
  try {
    const loaded = hl.getLoadedLanguages();
    if (lang !== "text" && !loaded.includes(lang as BundledLanguage)) {
      await hl.loadLanguage(lang as BundledLanguage);
    }
  } catch {
    lang = "text";
  }

  // Tokenize the full reconstructed file so shiki has proper context
  // (multi-line strings, template literals, etc.)
  const fullText = lines.join("\n");
  try {
    const result = hl.codeToTokens(fullText, {
      lang: lang as BundledLanguage,
      theme,
    });
    for (let i = 0; i < result.tokens.length && i < lines.length; i++) {
      map.set(lines[i], result.tokens[i]);
    }
  } catch {
    // Fallback: no highlighting
  }

  return map;
}

// ---------------------------------------------------------------------------
// Stat helpers
// ---------------------------------------------------------------------------

function StatBar({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  const total = additions + deletions;
  if (total === 0) return null;

  const blocks = 5;
  const addBlocks = Math.round((additions / total) * blocks);
  const delBlocks = blocks - addBlocks;

  return (
    <span className="inline-flex gap-px ml-2">
      {Array.from({ length: addBlocks }).map((_, i) => (
        <span
          key={`a${i}`}
          className="w-1.5 h-1.5 rounded-[1px] bg-green-500"
        />
      ))}
      {Array.from({ length: delBlocks }).map((_, i) => (
        <span key={`d${i}`} className="w-1.5 h-1.5 rounded-[1px] bg-red-500" />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const DiffView = memo(function DiffView({
  diff,
  className,
  defaultCollapsed = true,
  expandedFile,
}: DiffViewProps) {
  const files = useMemo(() => parseDiff(diff), [diff]);

  // Incremented each time a new file is selected from the sidebar — non-active
  // FileDiffCards watch this to know they should collapse.
  const [collapseSignal, setCollapseSignal] = useState(0);
  const prevExpandedFile = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // Only fire the collapse signal when expandedFile actually changes to a
    // new non-null value (i.e. the user clicked a different file in the sidebar).
    if (expandedFile != null && expandedFile !== prevExpandedFile.current) {
      setCollapseSignal((s) => s + 1);
    }
    prevExpandedFile.current = expandedFile;
  }, [expandedFile]);

  if (files.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        No changes found in this diff.
      </div>
    );
  }

  // Summary stats
  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className={cn("space-y-3 min-w-0", className)}>
      {/* Summary bar */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground px-1">
        <span>
          Showing{" "}
          <span className="font-medium text-foreground">{files.length}</span>{" "}
          changed {files.length === 1 ? "file" : "files"}
        </span>
        <span className="flex items-center gap-1">
          <Plus className="h-3 w-3 text-green-600 dark:text-green-400" />
          <span className="text-green-600 dark:text-green-400 font-medium">
            {totalAdditions}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <Minus className="h-3 w-3 text-red-600 dark:text-red-400" />
          <span className="text-red-600 dark:text-red-400 font-medium">
            {totalDeletions}
          </span>
        </span>
      </div>

      {/* File diffs */}
      {files.map((file, i) => {
        const filename =
          (file.to !== "/dev/null" ? file.to : undefined) ??
          (file.from !== "/dev/null" ? file.from : undefined) ??
          "unknown";
        const forceExpand =
          expandedFile != null &&
          (filename === expandedFile ||
            file.from === expandedFile ||
            file.to === expandedFile);
        return (
          <FileDiffCard
            key={`${file.from ?? ""}→${file.to ?? ""}-${i}`}
            file={file}
            defaultCollapsed={defaultCollapsed}
            forceExpand={forceExpand}
            isActive={forceExpand}
            collapseSignal={forceExpand ? undefined : collapseSignal}
          />
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Single file diff card
// ---------------------------------------------------------------------------

/** Files with more total changed lines than this are hidden until explicitly loaded. */
const LARGE_DIFF_THRESHOLD = 1000;

const FileDiffCard = memo(function FileDiffCard({
  file,
  defaultCollapsed,
  forceExpand = false,
  isActive = false,
  collapseSignal,
}: {
  file: parseDiff.File;
  defaultCollapsed: boolean;
  /** When true, force the card open and scroll it into view. */
  forceExpand?: boolean;
  /** When true, render with an accent border to indicate it is selected. */
  isActive?: boolean;
  /**
   * Incremented by the parent whenever a different file is selected from the
   * sidebar. Non-active cards collapse when this value changes.
   */
  collapseSignal?: number;
}) {
  const totalChanges = file.additions + file.deletions;
  const isLarge = totalChanges > LARGE_DIFF_THRESHOLD;

  // Large files start hidden (not just collapsed) until the user explicitly
  // clicks "Load diff" — mirrors GitHub's behaviour.
  const [hidden, setHidden] = useState(isLarge);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  const cardRef = useRef<HTMLDivElement>(null);

  // When forceExpand flips to true, open the card and scroll it into view.
  useEffect(() => {
    if (!forceExpand) return;
    setCollapsed(false);
    setHidden(false);
    // Small delay so the DOM has expanded before we scroll
    const id = setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => clearTimeout(id);
  }, [forceExpand]);

  // Collapse this card when another file is selected from the sidebar.
  // collapseSignal is undefined for the active card, so it won't self-collapse.
  const prevCollapseSignal = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      collapseSignal !== undefined &&
      prevCollapseSignal.current !== undefined &&
      collapseSignal !== prevCollapseSignal.current
    ) {
      setCollapsed(true);
    }
    prevCollapseSignal.current = collapseSignal;
  }, [collapseSignal]);

  const isDark = useIsDark();
  const theme = isDark ? "github-dark" : "github-light";
  const hl = useHighlighter();

  const filename =
    (file.to !== "/dev/null" ? file.to : undefined) ??
    (file.from !== "/dev/null" ? file.from : undefined) ??
    "unknown";
  const lang = langFromFilename(filename);
  const isNew = file.new === true || file.from === "/dev/null";
  const isDeleted = file.deleted === true || file.to === "/dev/null";
  const isRenamed = file.from !== file.to && !isNew && !isDeleted;

  // Collect all unique line contents for batch highlighting
  const allLines = useMemo(() => {
    const lines: string[] = [];
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        // Strip the leading +/- / space character from content
        const text = change.content.slice(1);
        lines.push(text);
      }
    }
    return lines;
  }, [file.chunks]);

  // Highlighted tokens
  const [tokenMap, setTokenMap] = useState<TokenMap>(new Map());

  useEffect(() => {
    if (!hl || collapsed) return;
    let cancelled = false;
    tokenizeLines(hl, allLines, lang as BundledLanguage, theme).then((map) => {
      if (!cancelled) setTokenMap(map);
    });
    return () => {
      cancelled = true;
    };
  }, [hl, allLines, lang, theme, collapsed]);

  const FileIcon = isNew ? FilePlus2 : isDeleted ? FileX2 : FileDiff;

  return (
    <div
      ref={cardRef}
      id={fileDiffCardId(filename)}
      className={cn(
        "rounded-lg border overflow-hidden scroll-mt-20 transition-colors",
        isActive
          ? "border-violet-500/60 ring-1 ring-violet-500/30"
          : "border-border/60",
      )}
    >
      {/* File header */}
      <button
        onClick={toggle}
        className={cn(
          "flex items-center gap-2 w-full px-3 py-2 text-left",
          "bg-muted/30 hover:bg-muted/50 transition-colors",
          "text-sm",
        )}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <FileIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isNew
              ? "text-green-600 dark:text-green-400"
              : isDeleted
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground",
          )}
        />
        <span className="font-mono text-xs truncate min-w-0 flex-1">
          {isRenamed ? (
            <>
              <span className="text-muted-foreground">{file.from}</span>
              <span className="text-muted-foreground/50 mx-1">→</span>
              <span className="text-foreground">{file.to}</span>
            </>
          ) : (
            <span className="text-foreground">{filename}</span>
          )}
        </span>

        {/* Stats */}
        <span className="flex items-center gap-2 shrink-0 text-xs">
          {file.additions > 0 && (
            <span className="text-green-600 dark:text-green-400 font-medium">
              +{file.additions}
            </span>
          )}
          {file.deletions > 0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              -{file.deletions}
            </span>
          )}
          <StatBar additions={file.additions} deletions={file.deletions} />
        </span>
      </button>

      {/* Large diff notice — shown instead of content until user loads it */}
      {!collapsed && hidden && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-500/5 border-t border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Large diff ({totalChanges.toLocaleString()} lines) not rendered by
            default.
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setHidden(false);
            }}
            className="shrink-0 rounded px-2 py-1 font-medium bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
          >
            Load diff
          </button>
        </div>
      )}

      {/* Diff content */}
      {!collapsed && !hidden && (
        <SyncedScrollArea>
          <table className="w-full border-collapse text-[13px] leading-[1.6] font-mono">
            <tbody>
              {file.chunks.map((chunk, ci) => (
                <ChunkRows
                  key={ci}
                  chunk={chunk}
                  tokenMap={tokenMap}
                  isFirstChunk={ci === 0}
                />
              ))}
            </tbody>
          </table>
        </SyncedScrollArea>
      )}

      {/* Binary / empty diff */}
      {!collapsed && !hidden && file.chunks.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          {isNew
            ? "Empty file added"
            : isDeleted
              ? "File deleted"
              : "Binary file changed"}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Chunk (hunk) rows
// ---------------------------------------------------------------------------

function ChunkRows({
  chunk,
  tokenMap,
  isFirstChunk,
}: {
  chunk: parseDiff.Chunk;
  tokenMap: TokenMap;
  isFirstChunk: boolean;
}) {
  return (
    <>
      {/* Hunk header */}
      <tr
        className={cn(
          "bg-blue-500/5 dark:bg-blue-400/5",
          !isFirstChunk && "border-t border-border/40",
        )}
      >
        <td
          colSpan={4}
          className="px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 font-mono select-none"
        >
          {chunk.content}
        </td>
      </tr>

      {/* Change lines */}
      {chunk.changes.map((change, i) => (
        <DiffLine key={i} change={change} tokenMap={tokenMap} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Single diff line
// ---------------------------------------------------------------------------

function DiffLine({
  change,
  tokenMap,
}: {
  change: parseDiff.Change;
  tokenMap: TokenMap;
}) {
  const text = change.content.slice(1); // strip leading +/-/space
  const tokens = tokenMap.get(text);

  const isAdd = change.type === "add";
  const isDel = change.type === "del";
  const isNormal = change.type === "normal";

  const oldLine = isNormal
    ? (change as parseDiff.NormalChange).ln1
    : isDel
      ? (change as parseDiff.DeleteChange).ln
      : null;
  const newLine = isNormal
    ? (change as parseDiff.NormalChange).ln2
    : isAdd
      ? (change as parseDiff.AddChange).ln
      : null;

  return (
    <tr
      data-line-old={oldLine}
      data-line-new={newLine}
      className={cn(
        "group",
        isAdd && "bg-green-500/15 dark:bg-green-400/12",
        isDel && "bg-red-500/15 dark:bg-red-400/12",
      )}
    >
      {/* Sticky gutter: old line · new line · +/- indicator.
          background-image layers the row tint over the solid bg-background
          so both are visible without fighting over background-color.
          The gutter uses a higher-opacity tint than the row so it reads
          as slightly darker without losing the hue. */}
      <td
        className="sticky left-0 select-none align-top p-0 w-[1%] whitespace-nowrap bg-background"
        style={
          isAdd
            ? {
                backgroundImage:
                  "linear-gradient(rgba(34,197,94,0.28),rgba(34,197,94,0.28))",
              }
            : isDel
              ? {
                  backgroundImage:
                    "linear-gradient(rgba(239,68,68,0.28),rgba(239,68,68,0.28))",
                }
              : {
                  backgroundImage:
                    "linear-gradient(rgba(0,0,0,0.035),rgba(0,0,0,0.035))",
                }
        }
      >
        <div className="flex items-stretch border-r border-border/30">
          {/* Old line number */}
          <span
            className={cn(
              "text-right px-2 py-0 min-w-[3ch]",
              "text-muted-foreground/60 group-hover:text-muted-foreground/90 transition-colors duration-75",
              isDel && "text-red-700/70 dark:text-red-400/70",
            )}
          >
            {oldLine ?? ""}
          </span>
          {/* New line number */}
          <span
            className={cn(
              "text-right px-2 py-0 min-w-[3ch] border-l border-border/30",
              "text-muted-foreground/60 group-hover:text-muted-foreground/90 transition-colors duration-75",
              isAdd && "text-green-700/70 dark:text-green-400/70",
            )}
          >
            {newLine ?? ""}
          </span>
          {/* +/- indicator */}
          <span
            className={cn(
              "text-center px-1 py-0 border-l border-border/30",
              isAdd && "text-green-600 dark:text-green-400",
              isDel && "text-red-600 dark:text-red-400",
              isNormal && "text-muted-foreground/40",
            )}
          >
            {isAdd ? "+" : isDel ? "-" : " "}
          </span>
        </div>
      </td>

      {/* Code content */}
      <td className="px-3 py-0 whitespace-pre">
        {tokens ? (
          tokens.map((token, j) => (
            <span key={j} style={{ color: token.color }}>
              {token.content}
            </span>
          ))
        ) : (
          <span className="text-foreground/85">{text}</span>
        )}
        {text === "" && <span>{"\n"}</span>}
      </td>
    </tr>
  );
}
