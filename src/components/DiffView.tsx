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
 *   - Inline code review comments with line-range selection
 *
 * Line selection:
 *   - Click a line number to select it (shows comment button + copy button)
 *   - Drag across line numbers to select a range
 *   - Shift-click to extend the selection to a range
 *   - Click the comment button (left gutter, GitHub-style) to open composer
 *   - Click the copy button to copy selected lines to clipboard
 */

import {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
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
  Loader2,
  WrapText,
  ArrowRightToLine,
  MessageSquarePlus,
  Copy,
  Check,
} from "lucide-react";
import type { FileChange } from "@/lib/git-grasp-pool";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { NostrEvent } from "nostr-tools";
import type { InlineCommentMap } from "@/hooks/useInlineComments";
import { getLineComments } from "@/hooks/useInlineComments";
import {
  InlineCommentThread,
  InlineCommentBadge,
} from "@/components/InlineCommentThread";
import type { InlineCommentOptions } from "@/blueprints/inline-comment";
import { getLastLineComments } from "@/hooks/useInlineComments";

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

// ---------------------------------------------------------------------------
// Inline comment context — passed down to DiffLine without prop drilling
// ---------------------------------------------------------------------------

interface InlineCommentCtx {
  rootEvent: NostrEvent;
  parentEvent: NostrEvent;
  commentMap: InlineCommentMap;
  /** Commit ID to attach to new inline comments */
  commitId?: string;
  /** Repo coordinates for q-tags */
  repoCoords?: string[];
  /** Relay hint for NIP-22 tags */
  relayHint?: string;
}

const InlineCommentContext = createContext<InlineCommentCtx | null>(null);

// ---------------------------------------------------------------------------
// Line selection context — shared across all DiffLine rows in a FileDiffCard
// ---------------------------------------------------------------------------

/**
 * A line key uniquely identifies a line in a diff, encoding both the change
 * type and line number to avoid collisions between deleted and added lines
 * that share the same number (e.g. del:1 vs add:1).
 *
 * Format: "add:<n>" | "del:<n>" | "normal:<n>"
 */
type LineKey = string;

function makeLineKey(type: "add" | "del" | "normal", n: number): LineKey {
  return `${type}:${n}`;
}

function lineKeyType(k: LineKey): "add" | "del" | "normal" {
  return k.split(":")[0] as "add" | "del" | "normal";
}

/**
 * Returns true if a candidate line is compatible with the anchor line for
 * selection purposes:
 *   - normal lines are always compatible (context lines)
 *   - add lines are compatible with add or normal anchors
 *   - del lines are compatible with del or normal anchors
 */
function isCompatibleWithAnchor(
  anchorType: "add" | "del" | "normal",
  candidateType: "add" | "del" | "normal",
): boolean {
  if (candidateType === "normal") return true;
  if (anchorType === "normal") return true;
  return anchorType === candidateType;
}

interface SelectionCtx {
  /** The anchor line key (where the drag/click started) */
  anchor: LineKey | null;
  /** The current end of the selection (may differ from anchor) */
  head: LineKey | null;
  /** Whether a drag is currently in progress */
  dragging: boolean;
  /** All line content strings keyed by LineKey, for copy */
  lineContents: Map<LineKey, string>;
  /**
   * Ordered list of all line keys in document order, used to compute
   * contiguous ranges between anchor and head.
   */
  lineOrder: LineKey[];
  setAnchor: (k: LineKey | null) => void;
  setHead: (k: LineKey | null) => void;
  setDragging: (v: boolean) => void;
  /** Open the inline comment composer for the current selection */
  openComposer: (lineOrRange: string, anchorKey: LineKey) => void;
  /** The line/range string currently being composed (if composer is open) */
  composingRange: string | null;
  /**
   * The LineKey of the line that opened the composer. Used to pin the thread
   * row to exactly one line even when two lines share the same number (del/add).
   */
  composingKey: LineKey | null;
  closeComposer: () => void;
}

const SelectionContext = createContext<SelectionCtx | null>(null);

/**
 * Returns the set of selected LineKeys between anchor and head (inclusive),
 * preserving document order via lineOrder.
 *
 * Only lines whose type is compatible with the anchor are included:
 *   - Starting on a del line → only del + normal lines are selectable
 *   - Starting on an add line → only add + normal lines are selectable
 *   - Starting on a normal line → all line types are selectable
 */
function selectedKeys(
  anchor: LineKey | null,
  head: LineKey | null,
  lineOrder: LineKey[],
): Set<LineKey> {
  if (anchor === null) return new Set();
  const h = head ?? anchor;
  const ai = lineOrder.indexOf(anchor);
  const hi = lineOrder.indexOf(h);
  if (ai === -1 || hi === -1) return new Set();
  const [from, to] = ai <= hi ? [ai, hi] : [hi, ai];
  const anchorType = lineKeyType(anchor);
  return new Set(
    lineOrder
      .slice(from, to + 1)
      .filter((k) => isCompatibleWithAnchor(anchorType, lineKeyType(k))),
  );
}

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
  /**
   * When set alongside expandedFile, scroll to this specific element ID
   * (a line anchor like "diff-src_lib_foo_ts_L42") instead of the file card.
   * The element must be a child of the expanded file card.
   *
   * Changing this value (even to the same string) triggers a new scroll
   * attempt, so callers should use a wrapper object or a counter to force
   * re-scrolling to the same target.
   */
  scrollTarget?: { id: string | null } | null;
  /**
   * Files whose diff content is still loading. A loading card (real header,
   * spinner body) is rendered for each entry, after any already-parsed files.
   */
  loadingFiles?: FileChange[];
  /**
   * When provided, enables inline code review comments.
   * The root PR or patch event — used to publish new comments.
   */
  rootEvent?: NostrEvent;
  /**
   * The immediate parent event for new comments (same as rootEvent for
   * top-level comments, or a PR update for revision-specific comments).
   */
  parentEvent?: NostrEvent;
  /**
   * Map of inline comments keyed by file+line, from useInlineComments().
   */
  commentMap?: InlineCommentMap;
  /** Commit ID to attach to new inline comments */
  commitId?: string;
  /** Repo coordinates for q-tags on new inline comments */
  repoCoords?: string[];
  /** Relay hint for NIP-22 tags */
  relayHint?: string;
}

import { fileDiffCardId, diffLineAnchorId } from "@/lib/diffCardId";

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
// Shared file-card header
// ---------------------------------------------------------------------------

/**
 * The clickable header row shared by both the real FileDiffCard and the
 * loading variant. Keeping it in one place means visual changes only need to
 * happen here.
 */
function FileDiffCardHeader({
  collapsed,
  onToggle,
  isNew,
  isDeleted,
  isRenamed,
  filename,
  fileFrom,
  fileTo,
  additions,
  deletions,
  hasLongLines,
  wordWrap,
  onToggleWrap,
}: {
  collapsed: boolean;
  onToggle: () => void;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  filename: string;
  /** Only needed when isRenamed is true */
  fileFrom?: string;
  /** Only needed when isRenamed is true */
  fileTo?: string;
  /** undefined while loading (stats not yet known) */
  additions?: number;
  deletions?: number;
  /** Whether any diff line exceeds the long-line threshold */
  hasLongLines?: boolean;
  /** Current word-wrap state */
  wordWrap?: boolean;
  /** Called when the wrap toggle button is clicked */
  onToggleWrap?: () => void;
}) {
  const FileIcon = isNew ? FilePlus2 : isDeleted ? FileX2 : FileDiff;

  return (
    <div
      className={cn(
        "flex items-center gap-2 w-full px-3 py-2",
        "bg-muted/80 hover:bg-muted/90 backdrop-blur-sm transition-colors",
        "text-sm sticky top-14 z-10 rounded-t-lg",
      )}
    >
      <button
        onClick={onToggle}
        className="flex items-center gap-2 min-w-0 flex-1 text-left"
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
              <span className="text-muted-foreground">{fileFrom}</span>
              <span className="text-muted-foreground/50 mx-1">→</span>
              <span className="text-foreground">{fileTo}</span>
            </>
          ) : (
            <span className="text-foreground">{filename}</span>
          )}
        </span>
      </button>

      {/* Stats — omitted while loading */}
      {additions !== undefined || deletions !== undefined ? (
        <span className="flex items-center gap-2 shrink-0 text-xs">
          {(additions ?? 0) > 0 && (
            <span className="text-green-600 dark:text-green-400 font-medium">
              +{additions}
            </span>
          )}
          {(deletions ?? 0) > 0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              -{deletions}
            </span>
          )}
          <StatBar additions={additions ?? 0} deletions={deletions ?? 0} />
        </span>
      ) : (
        /* Placeholder so the header height stays consistent */
        <span className="flex items-center gap-px ml-2 shrink-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-[1px] bg-muted-foreground/20"
            />
          ))}
        </span>
      )}

      {/* Wrap toggle — only shown when there are long lines and card is open */}
      {!collapsed && hasLongLines && onToggleWrap !== undefined && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onToggleWrap();
              }}
              aria-label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
            >
              {wordWrap ? (
                <WrapText className="h-3.5 w-3.5" />
              ) : (
                <ArrowRightToLine className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {wordWrap ? "Disable" : "Enable"} word wrap (Alt+Z)
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading variant — real header, spinner body
// ---------------------------------------------------------------------------

/**
 * Renders a collapsible card for a file whose diff content is still loading.
 * Uses the same FileDiffCardHeader as the real card so they stay in sync.
 */
export const FileDiffCardLoading = memo(function FileDiffCardLoading({
  change,
}: {
  change: FileChange;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  const isNew = change.status === "added";
  const isDeleted = change.status === "deleted";

  return (
    <div className="rounded-lg border border-border/60">
      <FileDiffCardHeader
        collapsed={collapsed}
        onToggle={toggle}
        isNew={isNew}
        isDeleted={isDeleted}
        isRenamed={false}
        filename={change.path}
      />
      {!collapsed && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground border-t border-border/40 bg-muted/10 rounded-b-lg overflow-hidden">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading diff…</span>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Parse a URL hash fragment into a file card ID and optional line anchor.
 *
 * Accepts hashes of the form:
 *   #diff-src_lib_foo_ts_L42   → { cardId: "diff-src_lib_foo_ts", lineId: "diff-src_lib_foo_ts_L42" }
 *   #diff-src_lib_foo_ts_DL42  → { cardId: "diff-src_lib_foo_ts", lineId: "diff-src_lib_foo_ts_DL42" }
 *   #diff-src_lib_foo_ts       → { cardId: "diff-src_lib_foo_ts", lineId: null }
 *
 * Returns null if the hash doesn't match a diff anchor pattern.
 */
function parseDiffHash(hash: string): {
  cardId: string;
  lineId: string | null;
} | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith("diff-")) return null;

  // Try line anchor: diff-{cardId}_(DL|L){n}
  const lineMatch = raw.match(/^(diff-.+?)_(DL|L)(\d+)$/);
  if (lineMatch) {
    return { cardId: lineMatch[1], lineId: raw };
  }

  // File-only anchor
  return { cardId: raw, lineId: null };
}

export const DiffView = memo(function DiffView({
  diff,
  className,
  defaultCollapsed = true,
  expandedFile,
  scrollTarget: externalScrollTarget,
  loadingFiles,
  rootEvent,
  parentEvent,
  commentMap,
  commitId,
  repoCoords,
  relayHint,
}: DiffViewProps) {
  const files = useMemo(() => parseDiff(diff), [diff]);

  // ---------------------------------------------------------------------------
  // Hash-driven expand + scroll — self-contained, works for all callers
  // ---------------------------------------------------------------------------
  // hashExpandedFile: the file path extracted from the URL hash (if any)
  // hashScrollTarget: the scroll target derived from the URL hash
  const [hashExpandedFile, setHashExpandedFile] = useState<string | null>(null);
  const [hashScrollTarget, setHashScrollTarget] = useState<{
    id: string | null;
  } | null>(null);

  // Apply a hash string against the current file list.
  const applyHash = useCallback((hash: string, fileList: parseDiff.File[]) => {
    if (!hash) return;
    const parsed = parseDiffHash(hash);
    if (!parsed) return;

    // Find the file whose card ID matches
    const matched = fileList.find((f) => {
      const name =
        (f.to !== "/dev/null" ? f.to : undefined) ??
        (f.from !== "/dev/null" ? f.from : undefined) ??
        "unknown";
      return fileDiffCardId(name) === parsed.cardId;
    });
    if (!matched) return;

    const name =
      (matched.to !== "/dev/null" ? matched.to : undefined) ??
      (matched.from !== "/dev/null" ? matched.from : undefined) ??
      "unknown";

    setHashExpandedFile(name);
    // Always create a new object so the scroll effect fires even when
    // navigating back to the same line.
    setHashScrollTarget({ id: parsed.lineId });
  }, []);

  // On mount (and whenever the file list changes from empty→populated),
  // apply the current hash.
  const appliedInitialHash = useRef(false);
  useEffect(() => {
    if (files.length === 0) return;
    if (appliedInitialHash.current) return;
    appliedInitialHash.current = true;
    applyHash(window.location.hash, files);
  }, [files, applyHash]);

  // Re-apply on hashchange (in-page navigation).
  useEffect(() => {
    const onHashChange = () => applyHash(window.location.hash, files);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [files, applyHash]);

  // ---------------------------------------------------------------------------
  // Sidebar-driven expand + collapse signal
  // ---------------------------------------------------------------------------
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

  // Merge: sidebar selection takes priority over hash selection for expandedFile.
  // For scrollTarget, external prop takes priority (sidebar clicks clear hash scroll).
  const effectiveExpandedFile = expandedFile ?? hashExpandedFile;
  const effectiveScrollTarget = externalScrollTarget ?? hashScrollTarget;

  const totalFiles = files.length + (loadingFiles?.length ?? 0);

  if (totalFiles === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        No changes found in this diff.
      </div>
    );
  }

  // Summary stats
  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
  const isLoading = (loadingFiles?.length ?? 0) > 0;

  const ctxValue: InlineCommentCtx | null =
    rootEvent && commentMap
      ? {
          rootEvent,
          parentEvent: parentEvent ?? rootEvent,
          commentMap,
          commitId,
          repoCoords,
          relayHint,
        }
      : null;

  const inner = (
    <div className={cn("space-y-3 min-w-0", className)}>
      {/* Summary bar */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground px-1">
        <span>
          Showing{" "}
          <span className="font-medium text-foreground">{totalFiles}</span>{" "}
          changed {totalFiles === 1 ? "file" : "files"}
        </span>
        {!isLoading && (
          <>
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
          </>
        )}
        {isLoading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
      </div>

      {/* Parsed file diffs */}
      {files.map((file, i) => {
        const filename =
          (file.to !== "/dev/null" ? file.to : undefined) ??
          (file.from !== "/dev/null" ? file.from : undefined) ??
          "unknown";
        const isTargeted =
          effectiveExpandedFile != null &&
          (filename === effectiveExpandedFile ||
            file.from === effectiveExpandedFile ||
            file.to === effectiveExpandedFile);
        return (
          <FileDiffCard
            key={`${file.from ?? ""}→${file.to ?? ""}-${i}`}
            file={file}
            defaultCollapsed={defaultCollapsed}
            isActive={isTargeted}
            collapseSignal={isTargeted ? undefined : collapseSignal}
            scrollTarget={isTargeted ? effectiveScrollTarget : undefined}
          />
        );
      })}

      {/* Loading cards for files whose diff content hasn't arrived yet */}
      {loadingFiles?.map((change) => (
        <FileDiffCardLoading key={change.path} change={change} />
      ))}
    </div>
  );

  if (ctxValue) {
    return (
      <InlineCommentContext.Provider value={ctxValue}>
        {inner}
      </InlineCommentContext.Provider>
    );
  }
  return inner;
});

// ---------------------------------------------------------------------------
// Single file diff card
// ---------------------------------------------------------------------------

/** Files with more total changed lines than this are hidden until explicitly loaded. */
const LARGE_DIFF_THRESHOLD = 1000;
/** Columns beyond this threshold mean the diff has long lines worth wrapping. */
const LONG_LINE_THRESHOLD = 120;

const FileDiffCard = memo(function FileDiffCard({
  file,
  defaultCollapsed,
  isActive = false,
  collapseSignal,
  scrollTarget,
}: {
  file: parseDiff.File;
  defaultCollapsed: boolean;
  /** When true, render with an accent border to indicate it is selected. */
  isActive?: boolean;
  /**
   * Incremented by the parent whenever a different file is selected from the
   * sidebar. Non-active cards collapse when this value changes.
   */
  collapseSignal?: number;
  /**
   * When set, expand this card and scroll to the given element ID (or to the
   * card header if id is null). A new object reference triggers a new scroll
   * even when the id string hasn't changed.
   */
  scrollTarget?: { id: string | null } | null;
}) {
  const totalChanges = file.additions + file.deletions;
  const isLarge = totalChanges > LARGE_DIFF_THRESHOLD;

  // Large files start hidden (not just collapsed) until the user explicitly
  // clicks "Load diff" — mirrors GitHub's behaviour.
  const [hidden, setHidden] = useState(isLarge);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  // Word-wrap state — on by default
  const [wordWrap, setWordWrap] = useState(true);
  const toggleWrap = useCallback(() => setWordWrap((w) => !w), []);

  const cardRef = useRef<HTMLDivElement>(null);

  // When a scrollTarget arrives (or changes), expand the card.
  useEffect(() => {
    if (!scrollTarget) return;
    setCollapsed(false);
    setHidden(false);
  }, [scrollTarget]);

  // Once the card is open AND a scrollTarget is set, scroll to the target.
  // We defer with rAF so the browser has painted the newly-expanded rows
  // before we call scrollIntoView (layout must be complete for it to work).
  // We retry for up to ~1s to handle slow syntax-highlighting renders.
  const lastScrolledTarget = useRef<{ id: string | null } | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!scrollTarget) return;
    if (collapsed) return; // not open yet — wait for next render
    // Don't re-scroll if we already handled this exact target object
    if (scrollTarget === lastScrolledTarget.current) return;
    lastScrolledTarget.current = scrollTarget;

    const targetId = scrollTarget.id;
    let cancelled = false;

    function doScroll(): boolean {
      if (targetId) {
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("diff-line-highlight");
          setTimeout(() => el.classList.remove("diff-line-highlight"), 2000);
          return true;
        }
        return false;
      } else {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return true;
      }
    }

    // Defer to next frame so the browser has laid out the expanded rows
    let attempts = 0;
    const maxAttempts = 60; // ~1s at 60fps
    function attempt() {
      if (cancelled) return;
      if (doScroll() || attempts >= maxAttempts) return;
      attempts++;
      requestAnimationFrame(attempt);
    }
    requestAnimationFrame(attempt);

    return () => {
      cancelled = true;
    };
  }, [scrollTarget, collapsed]);

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

  // Whether any diff line exceeds the threshold
  const hasLongLines = useMemo(
    () => allLines.some((l) => l.length > LONG_LINE_THRESHOLD),
    [allLines],
  );

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

  // Alt+Z keyboard shortcut — scoped to this card
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !hasLongLines) return;
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        toggleWrap();
      }
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [hasLongLines, toggleWrap]);

  // ---------------------------------------------------------------------------
  // Line selection state (for range comments and copy)
  // ---------------------------------------------------------------------------

  const [selAnchor, setSelAnchor] = useState<LineKey | null>(null);
  const [selHead, setSelHead] = useState<LineKey | null>(null);
  const [dragging, setDragging] = useState(false);
  const [composingRange, setComposingRange] = useState<string | null>(null);
  const [composingKey, setComposingKey] = useState<LineKey | null>(null);

  // Build a map of LineKey → raw text content for copy support, and an
  // ordered list of all LineKeys in document order for range computation.
  const { lineContents, lineOrder } = useMemo(() => {
    const contents = new Map<LineKey, string>();
    const order: LineKey[] = [];
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        const type = change.type; // "add" | "del" | "normal"
        const isAdd = type === "add";
        const isDel = type === "del";
        const isNormal = type === "normal";
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
        const n = newLine ?? oldLine;
        if (n !== undefined && n !== null) {
          const key = makeLineKey(type as "add" | "del" | "normal", n);
          contents.set(key, change.content.slice(1));
          order.push(key);
        }
      }
    }
    return { lineContents: contents, lineOrder: order };
  }, [file.chunks]);

  // Ctrl+C — copy selected lines when a selection exists
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "c") return;
      if (selAnchor === null) return;
      e.preventDefault();
      const selected = selectedKeys(selAnchor, selHead ?? selAnchor, lineOrder);
      const lines: string[] = [];
      for (const k of lineOrder) {
        if (selected.has(k)) {
          const content = lineContents.get(k);
          if (content !== undefined) lines.push(content);
        }
      }
      navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [selAnchor, selHead, lineContents, lineOrder]);

  const openComposer = useCallback(
    (lineOrRange: string, anchorKey: LineKey) => {
      setComposingRange(lineOrRange);
      setComposingKey(anchorKey);
    },
    [],
  );

  const closeComposer = useCallback(() => {
    setComposingRange(null);
    setComposingKey(null);
    setSelAnchor(null);
    setSelHead(null);
  }, []);

  // Clear selection when clicking outside the table
  useEffect(() => {
    if (selAnchor === null) return;
    const handler = (e: MouseEvent) => {
      const el = cardRef.current;
      if (el && !el.contains(e.target as Node)) {
        setSelAnchor(null);
        setSelHead(null);
        setComposingRange(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selAnchor]);

  // End drag on mouseup anywhere
  useEffect(() => {
    if (!dragging) return;
    const handler = () => setDragging(false);
    document.addEventListener("mouseup", handler);
    return () => document.removeEventListener("mouseup", handler);
  }, [dragging]);

  const selCtxValue: SelectionCtx = useMemo(
    () => ({
      anchor: selAnchor,
      head: selHead,
      dragging,
      lineContents,
      lineOrder,
      setAnchor: setSelAnchor,
      setHead: setSelHead,
      setDragging,
      openComposer,
      composingRange,
      composingKey,
      closeComposer,
    }),
    [
      selAnchor,
      selHead,
      dragging,
      lineContents,
      lineOrder,
      openComposer,
      composingRange,
      composingKey,
      closeComposer,
    ],
  );

  return (
    <div
      ref={cardRef}
      id={fileDiffCardId(filename)}
      tabIndex={-1}
      className={cn(
        "rounded-lg border scroll-mt-20 transition-colors",
        isActive
          ? "border-pink-500/60 ring-1 ring-pink-500/30"
          : "border-border/60",
      )}
    >
      <FileDiffCardHeader
        collapsed={collapsed}
        onToggle={toggle}
        isNew={isNew}
        isDeleted={isDeleted}
        isRenamed={isRenamed}
        filename={filename}
        fileFrom={file.from}
        fileTo={file.to}
        additions={file.additions}
        deletions={file.deletions}
        hasLongLines={hasLongLines}
        wordWrap={wordWrap}
        onToggleWrap={toggleWrap}
      />

      <div className="overflow-hidden rounded-b-lg">
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
          <SelectionContext.Provider value={selCtxValue}>
            <SyncedScrollArea
              className={cn(
                "[&::-webkit-scrollbar]:hidden",
                !wordWrap && "overflow-x-auto",
              )}
            >
              <table className="w-full border-collapse text-[13px] leading-[1.6] font-mono">
                <tbody>
                  {file.chunks.map((chunk, ci) => (
                    <ChunkRows
                      key={ci}
                      chunk={chunk}
                      tokenMap={tokenMap}
                      isFirstChunk={ci === 0}
                      wordWrap={wordWrap}
                      filename={filename}
                    />
                  ))}
                </tbody>
              </table>
            </SyncedScrollArea>
          </SelectionContext.Provider>
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
  wordWrap,
  filename,
}: {
  chunk: parseDiff.Chunk;
  tokenMap: TokenMap;
  isFirstChunk: boolean;
  wordWrap: boolean;
  filename: string;
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
          colSpan={10}
          className="px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 font-mono select-none"
        >
          {chunk.content}
        </td>
      </tr>

      {/* Change lines */}
      {chunk.changes.map((change, i) => (
        <DiffLine
          key={i}
          change={change}
          tokenMap={tokenMap}
          wordWrap={wordWrap}
          filename={filename}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Copy-to-clipboard button with transient "copied" feedback
// ---------------------------------------------------------------------------

function CopyButton({
  getText,
  className,
}: {
  getText: () => string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const text = getText();
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [getText],
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleCopy}
          className={cn(
            "p-0.5 rounded transition-colors",
            copied
              ? "text-green-500"
              : "text-muted-foreground/60 hover:text-foreground",
            className,
          )}
          aria-label="Copy selected lines"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {copied ? "Copied!" : "Copy lines"}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Single diff line
// ---------------------------------------------------------------------------

function DiffLine({
  change,
  tokenMap,
  wordWrap,
  filename,
}: {
  change: parseDiff.Change;
  tokenMap: TokenMap;
  wordWrap: boolean;
  filename: string;
}) {
  const ctx = useContext(InlineCommentContext);
  const sel = useContext(SelectionContext);

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

  // Canonical line number for comment storage (new preferred, else old)
  const lineNumber = newLine ?? oldLine ?? null;

  // Unique key for this line — encodes type to avoid del:1 / add:1 collisions
  const lineKey: LineKey | null =
    lineNumber !== null
      ? makeLineKey(change.type as "add" | "del" | "normal", lineNumber)
      : null;

  // ---------------------------------------------------------------------------
  // Selection logic — all keyed by LineKey, not plain number
  // ---------------------------------------------------------------------------

  const selectedSet = useMemo(
    () =>
      sel
        ? selectedKeys(sel.anchor, sel.head, sel.lineOrder)
        : new Set<LineKey>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel?.anchor, sel?.head, sel?.lineOrder],
  );

  const isSelected = lineKey !== null && selectedSet.has(lineKey);

  // Is this the last key in the selection (in document order)?
  const isRangeEnd =
    lineKey !== null &&
    sel !== null &&
    sel.head !== null &&
    sel.lineOrder.indexOf(lineKey) ===
      Math.max(
        sel.lineOrder.indexOf(sel.anchor ?? ""),
        sel.lineOrder.indexOf(sel.head),
      );

  const isSingleSelected =
    isSelected && selectedSet.size === 1 && selectedSet.has(lineKey!);

  const handleLineNumberMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!sel || lineKey === null) return;
      e.preventDefault(); // prevent browser text selection
      if (e.shiftKey && sel.anchor !== null) {
        // Only extend if this line is compatible with the anchor type
        if (
          isCompatibleWithAnchor(lineKeyType(sel.anchor), lineKeyType(lineKey))
        ) {
          sel.setHead(lineKey);
        }
      } else {
        sel.setAnchor(lineKey);
        sel.setHead(lineKey);
        sel.setDragging(true);
        if (sel.composingRange !== null) sel.closeComposer();
      }
    },
    [sel, lineKey],
  );

  const handleLineNumberMouseEnter = useCallback(() => {
    if (!sel || !sel.dragging || lineKey === null || sel.anchor === null)
      return;
    // Only extend the selection to lines compatible with the anchor type
    if (!isCompatibleWithAnchor(lineKeyType(sel.anchor), lineKeyType(lineKey)))
      return;
    sel.setHead(lineKey);
  }, [sel, lineKey]);

  // ---------------------------------------------------------------------------
  // Build the line/range string for the comment tag from the selected keys
  // ---------------------------------------------------------------------------

  // Extract the numeric line numbers from the selected keys in order,
  // then build a range string like "42" or "42-48".
  const lineRangeStr = useMemo(() => {
    if (!sel || selectedSet.size === 0 || !isSelected) {
      return lineNumber !== null ? String(lineNumber) : null;
    }
    const nums: number[] = [];
    for (const k of sel.lineOrder) {
      if (selectedSet.has(k)) {
        const n = parseInt(k.split(":")[1], 10);
        if (!isNaN(n)) nums.push(n);
      }
    }
    if (nums.length === 0)
      return lineNumber !== null ? String(lineNumber) : null;
    const min = nums[0];
    const max = nums[nums.length - 1];
    return min === max ? String(min) : `${min}-${max}`;
  }, [sel, selectedSet, isSelected, lineNumber]);

  // ---------------------------------------------------------------------------
  // Inline comment state
  // ---------------------------------------------------------------------------

  // The thread row renders on the line that opened the composer (composingKey),
  // which is type-specific — so del:1 and add:1 never both show a thread.
  const isComposingRangeEnd =
    sel !== null &&
    sel.composingKey !== null &&
    lineKey !== null &&
    sel.composingKey === lineKey;

  // Comments whose range ends on this line — the thread renders here only.
  const lastLineComments =
    ctx && lineNumber !== null
      ? getLastLineComments(
          ctx.commentMap,
          filename,
          lineNumber,
          change.type as "add" | "del" | "normal",
        )
      : [];

  // All comments that cover this line (including multi-line ranges that end
  // later). Used only for the range indicator badge on intermediate lines.
  const allCoveringComments =
    ctx && lineNumber !== null
      ? getLineComments(
          ctx.commentMap,
          filename,
          lineNumber,
          change.type as "add" | "del" | "normal",
        )
      : [];

  // True when this line is covered by a comment but is NOT the last line
  // (i.e. the thread will appear on a later line).
  const hasRangeIndicator =
    allCoveringComments.length > 0 && lastLineComments.length === 0;

  const hasComments = lastLineComments.length > 0;
  const showThread = hasComments || isComposingRangeEnd;

  const commentOptions: InlineCommentOptions | null =
    ctx && lineNumber !== null
      ? {
          filePath: filename,
          commitId: ctx.commitId,
          line: sel?.composingRange ?? String(lineNumber),
          // If the composer was opened from a deleted line, mark the side so
          // the line number is understood as an old-file (pre-commit) reference.
          lineSide:
            sel?.composingKey !== null &&
            sel?.composingKey !== undefined &&
            lineKeyType(sel.composingKey) === "del"
              ? "del"
              : undefined,
          repoCoords: ctx.repoCoords,
          relayHint: ctx.relayHint,
        }
      : null;

  // Copy text for the selected range
  const getCopyText = useCallback(() => {
    if (!sel || selectedSet.size === 0) return text;
    const lines: string[] = [];
    for (const k of sel.lineOrder) {
      if (selectedSet.has(k)) {
        const content = sel.lineContents.get(k);
        if (content !== undefined) lines.push(content);
      }
    }
    return lines.join("\n");
  }, [sel, selectedSet, text]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Column count: gutter (1) + code (1) + [comment action if ctx] (1) = 2 or 3
  const colCount = ctx ? 3 : 2;

  // Stable anchor ID for this line — used by permalink links from inline comment banners.
  const lineAnchorId =
    newLine !== null
      ? diffLineAnchorId(filename, newLine, "new")
      : oldLine !== null
        ? diffLineAnchorId(filename, oldLine, "del")
        : undefined;

  return (
    <>
      <tr
        id={lineAnchorId}
        data-line-old={oldLine}
        data-line-new={newLine}
        className={cn(
          "group",
          isAdd && !isSelected && "bg-green-500/15 dark:bg-green-400/12",
          isDel && !isSelected && "bg-red-500/15 dark:bg-red-400/12",
          isSelected && "bg-blue-500/20 dark:bg-blue-400/18",
        )}
      >
        {/* Sticky gutter: comment button (left, GitHub-style) · old line · new line · +/- indicator */}
        <td
          className="sticky left-0 select-none align-top p-0 w-[1%] whitespace-nowrap bg-background"
          style={
            isSelected
              ? {
                  backgroundImage:
                    "linear-gradient(rgba(59,130,246,0.32),rgba(59,130,246,0.32))",
                }
              : isAdd
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
            {/* Left comment button — GitHub-style, shown on hover or when selected */}
            {ctx && lineKey !== null ? (
              <div className="flex items-center justify-center w-5 shrink-0">
                {hasComments ? (
                  <InlineCommentBadge
                    count={lastLineComments.length}
                    onClick={() => {
                      if (sel && lineNumber !== null && lineKey !== null) {
                        sel.setAnchor(lineKey);
                        sel.setHead(lineKey);
                        sel.openComposer(String(lineNumber), lineKey);
                      }
                    }}
                  />
                ) : hasRangeIndicator ? (
                  /* Range indicator — this line is covered by a comment whose
                     thread appears on a later line. Clicking it is a no-op
                     visually (the thread is below), but provides a clear signal. */
                  <div
                    className="w-1.5 h-full self-stretch rounded-sm bg-blue-500/40 mx-auto cursor-default"
                    title="Part of a multi-line comment"
                    aria-label="Covered by inline comment"
                  />
                ) : (
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!sel || lineNumber === null || lineKey === null)
                        return;
                      if (isSelected && lineRangeStr) {
                        // For a range, anchor the thread to the last selected key
                        const lastKey = sel.head ?? sel.anchor ?? lineKey;
                        sel.openComposer(lineRangeStr, lastKey);
                      } else {
                        sel.setAnchor(lineKey);
                        sel.setHead(lineKey);
                        sel.openComposer(String(lineNumber), lineKey);
                      }
                    }}
                    className={cn(
                      "transition-opacity p-0.5 rounded",
                      "text-muted-foreground/50 hover:text-blue-500",
                      isSelected || isSingleSelected
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                    title="Add a comment"
                    aria-label="Add inline comment"
                  >
                    <MessageSquarePlus className="h-3 w-3" />
                  </button>
                )}
              </div>
            ) : (
              /* Spacer when inline comments are disabled */
              ctx && <div className="w-5 shrink-0" />
            )}

            {/* Old line number */}
            <span
              onMouseDown={handleLineNumberMouseDown}
              onMouseEnter={handleLineNumberMouseEnter}
              className={cn(
                "text-right px-2 py-0 min-w-[3ch] cursor-pointer",
                "text-muted-foreground/60 transition-colors duration-75",
                !isSelected &&
                  "group-hover:text-muted-foreground/90 hover:bg-blue-500/10",
                isDel && !isSelected && "text-red-700/70 dark:text-red-400/70",
                isSelected && "text-blue-600 dark:text-blue-400",
              )}
            >
              {oldLine ?? ""}
            </span>
            {/* New line number */}
            <span
              onMouseDown={handleLineNumberMouseDown}
              onMouseEnter={handleLineNumberMouseEnter}
              className={cn(
                "text-right px-2 py-0 min-w-[3ch] border-l border-border/30 cursor-pointer",
                "text-muted-foreground/60 transition-colors duration-75",
                !isSelected &&
                  "group-hover:text-muted-foreground/90 hover:bg-blue-500/10",
                isAdd &&
                  !isSelected &&
                  "text-green-700/70 dark:text-green-400/70",
                isSelected && "text-blue-600 dark:text-blue-400",
              )}
            >
              {newLine ?? ""}
            </span>
            {/* +/- indicator */}
            <span
              className={cn(
                "text-center px-1 py-0 border-l border-border/30",
                isAdd && !isSelected && "text-green-600 dark:text-green-400",
                isDel && !isSelected && "text-red-600 dark:text-red-400",
                isNormal && !isSelected && "text-muted-foreground/40",
                isSelected && "text-blue-500/70",
              )}
            >
              {isAdd ? "+" : isDel ? "-" : " "}
            </span>
          </div>
        </td>

        {/* Code content */}
        <td
          className={cn(
            "px-3 py-0",
            wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
          )}
          style={(() => {
            if (!wordWrap) return undefined;
            const indent = text.length - text.trimStart().length;
            if (indent === 0) return undefined;
            return {
              paddingLeft: `calc(0.75rem + ${indent}ch)`,
              textIndent: `-${indent}ch`,
            };
          })()}
        >
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

        {/* Right action column — copy button appears on the last selected line */}
        {ctx && (
          <td className="w-[1%] whitespace-nowrap align-top p-0 pr-1">
            <div className="flex items-center gap-0.5 h-full py-0 pl-1">
              {isRangeEnd && <CopyButton getText={getCopyText} />}
            </div>
          </td>
        )}
      </tr>

      {/* Inline comment thread — rendered as a full-width row below the line */}
      {ctx && showThread && commentOptions && (
        <tr>
          <td colSpan={colCount} className="p-0 pb-1">
            <InlineCommentThread
              comments={lastLineComments}
              rootEvent={ctx.rootEvent}
              parentEvent={ctx.parentEvent}
              commentOptions={commentOptions}
              onClose={() => sel?.closeComposer()}
              autoFocus={isComposingRangeEnd && !hasComments}
            />
          </td>
        </tr>
      )}
    </>
  );
}
