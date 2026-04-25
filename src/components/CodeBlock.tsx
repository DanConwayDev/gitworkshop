/**
 * CodeBlock — syntax-highlighted code viewer with line numbers.
 *
 * Uses shiki for accurate TextMate-grammar highlighting (same as VS Code).
 * The highlighter is loaded lazily on first render; while loading, the raw
 * text is shown in a plain <pre> with line numbers so there's no layout
 * shift.
 *
 * Line selection (mirrors DiffView behaviour):
 *   - Click a line number to select it (shows copy + permalink buttons)
 *   - Drag across line numbers to select a range
 *   - Shift-click to extend the selection to a range
 *   - Click the copy button to copy selected lines to clipboard (Ctrl+C also works)
 *   - Click the permalink button to copy a URL with a #L{n} or #L{n}-L{m} hash
 *   - Esc / click outside clears the selection
 *
 * Hash-driven highlighting:
 *   - On mount, if the URL hash matches a code anchor for this file, the
 *     relevant lines are pre-selected and scrolled into view.
 */

import { memo, useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  getHighlighter,
  langFromFilename,
  type ThemedToken,
} from "@/lib/highlighter";
import type { Highlighter, BundledLanguage } from "shiki";
import { cn } from "@/lib/utils";
import { SyncedScrollArea } from "@/components/SyncedScrollArea";
import { WrapText, ArrowRightToLine, Copy, Check, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  codeLineAnchorId,
  codeLineRangeHash,
  parseCodeLineHash,
} from "@/lib/diffCardId";

// ---------------------------------------------------------------------------
// Theme hook — detect dark mode
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

export interface CodeBlockProps {
  /** Source code to highlight */
  code: string;
  /** Filename — used to infer the language */
  filename?: string;
  /**
   * Repo-root-relative file path (e.g. "src/lib/foo.ts").
   * When provided, enables line-anchor IDs and permalink support.
   */
  filePath?: string;
  /** Explicit language override (shiki BundledLanguage id) */
  language?: string;
  /** Starting line number (default 1). Useful for showing a slice of a file. */
  startLine?: number;
  /** Extra class on the outer wrapper */
  className?: string;
  /** Whether to show line numbers (default true) */
  showLineNumbers?: boolean;
  /** Lines to highlight (1-indexed). Renders with a subtle background. */
  highlightLines?: Set<number>;
  /**
   * When provided, the component will pre-select this line range on mount
   * (driven by the parent parsing the URL hash). Overrides hash-driven
   * selection when both are present.
   */
  initialLineRange?: { startLine: number; endLine: number } | null;
  /**
   * When provided, scroll to this line on mount (after selection is applied).
   * A new object reference triggers a new scroll even when the line number
   * hasn't changed.
   */
  scrollToLine?: { line: number } | null;
}

// ---------------------------------------------------------------------------
// Copy button
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
            "flex items-center justify-center w-5 h-5 rounded transition-colors",
            copied
              ? "text-green-500"
              : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/60",
            className,
          )}
          aria-label="Copy selected lines"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
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
// Permalink button
// ---------------------------------------------------------------------------

function PermalinkButton({
  filePath,
  startLine,
  endLine,
  className,
}: {
  filePath: string;
  startLine: number;
  endLine: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const getUrl = useCallback((): string => {
    const hash = codeLineRangeHash(filePath, startLine, endLine);
    const url = new URL(window.location.href);
    url.hash = hash;
    return url.toString();
  }, [filePath, startLine, endLine]);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const url = getUrl();
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [getUrl],
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleCopy}
          className={cn(
            "flex items-center justify-center w-5 h-5 rounded transition-colors",
            copied
              ? "text-green-500"
              : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/60",
            className,
          )}
          aria-label="Copy permalink"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Link className="h-3 w-3" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {copied ? "Copied!" : "Copy permalink"}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Columns beyond this threshold mean the file has long lines worth wrapping. */
const LONG_LINE_THRESHOLD = 120;

export const CodeBlock = memo(function CodeBlock({
  code,
  filename,
  filePath,
  language,
  startLine = 1,
  className,
  showLineNumbers = true,
  highlightLines,
  initialLineRange: externalLineRange,
  scrollToLine: externalScrollToLine,
}: CodeBlockProps) {
  const isDark = useIsDark();
  const theme = isDark ? "github-dark" : "github-light";

  // Resolve language
  const lang = language ?? (filename ? langFromFilename(filename) : "text");

  // Highlighted tokens — null while loading
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [hl, setHl] = useState<Highlighter | null>(null);

  // Word-wrap state — on by default
  const [wordWrap, setWordWrap] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load highlighter once
  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((h) => {
      if (!cancelled) setHl(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tokenize when highlighter, code, lang, or theme changes
  useEffect(() => {
    if (!hl) return;
    let cancelled = false;

    async function tokenize() {
      try {
        // Load language on demand if not already loaded
        const loadedLangs = hl!.getLoadedLanguages();
        if (lang !== "text" && !loadedLangs.includes(lang as BundledLanguage)) {
          await hl!.loadLanguage(lang as BundledLanguage);
        }

        if (cancelled) return;

        const result = hl!.codeToTokens(code, {
          lang: lang as BundledLanguage,
          theme,
        });
        if (!cancelled) {
          setTokens(result.tokens);
        }
      } catch {
        // Language not available — fall back to plain text
        if (!cancelled) {
          const result = hl!.codeToTokens(code, { lang: "text", theme });
          setTokens(result.tokens);
        }
      }
    }

    tokenize();
    return () => {
      cancelled = true;
    };
  }, [hl, code, lang, theme]);

  // Plain-text lines for the fallback (before shiki loads)
  const plainLines = useMemo(() => code.split("\n"), [code]);
  const lineCount = tokens ? tokens.length : plainLines.length;
  // Width of the gutter (character count of the largest line number)
  const gutterWidth = showLineNumbers
    ? String(startLine + lineCount - 1).length
    : 0;

  // Whether any line exceeds the threshold — only show toggle when relevant
  const hasLongLines = useMemo(
    () => plainLines.some((l) => l.length > LONG_LINE_THRESHOLD),
    [plainLines],
  );

  // Leading-whitespace character count per line — used for hanging indent in wrap mode
  const indentWidths = useMemo(
    () => plainLines.map((l) => l.length - l.trimStart().length),
    [plainLines],
  );

  const toggleWrap = useCallback(() => setWordWrap((w) => !w), []);

  // Alt+Z keyboard shortcut — scoped to this container
  useEffect(() => {
    const el = containerRef.current;
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
  // Line selection state
  // ---------------------------------------------------------------------------

  // null = no selection; number = 1-indexed line number
  const [selAnchor, setSelAnchor] = useState<number | null>(null);
  const [selHead, setSelHead] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const selStart =
    selAnchor !== null && selHead !== null
      ? Math.min(selAnchor, selHead)
      : selAnchor;
  const selEnd =
    selAnchor !== null && selHead !== null
      ? Math.max(selAnchor, selHead)
      : selAnchor;

  const isLineSelected = useCallback(
    (lineNum: number): boolean => {
      if (selStart === null || selEnd === null) return false;
      return lineNum >= selStart && lineNum <= selEnd;
    },
    [selStart, selEnd],
  );

  // Apply initial line range from external prop (parent parsed URL hash)
  const appliedExternalRange = useRef(false);
  useEffect(() => {
    if (appliedExternalRange.current) return;
    if (!externalLineRange) return;
    appliedExternalRange.current = true;
    setSelAnchor(externalLineRange.startLine);
    setSelHead(externalLineRange.endLine);
  }, [externalLineRange]);

  // Apply hash-driven selection — self-contained, no parent needed.
  // Runs on mount and on every hashchange so in-page navigation works.
  const applyHash = useCallback(
    (hash: string) => {
      if (!filePath || !hash) return;
      const parsed = parseCodeLineHash(hash);
      if (!parsed || parsed.startLine === null) return;
      const expectedSanitised = filePath.replace(/[^a-zA-Z0-9_-]/g, "_");
      if (parsed.sanitisedPath !== expectedSanitised) return;
      setSelAnchor(parsed.startLine);
      setSelHead(parsed.endLine ?? parsed.startLine);
    },
    [filePath],
  );

  // Mount: apply current hash once
  const appliedHashRange = useRef(false);
  useEffect(() => {
    if (appliedHashRange.current) return;
    if (!filePath) return;
    appliedHashRange.current = true;
    applyHash(window.location.hash);
  }, [filePath, applyHash]);

  // Re-apply on hashchange (in-page navigation)
  useEffect(() => {
    const handler = () => applyHash(window.location.hash);
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, [applyHash]);

  // Scroll to the anchor line once selection is applied.
  // externalScrollToLine uses object identity so the parent can force a
  // re-scroll to the same line by passing a new object reference.
  useEffect(() => {
    const targetLine = externalScrollToLine?.line ?? selAnchor;
    if (targetLine === null || targetLine === undefined) return;
    if (!filePath) return;

    const id = codeLineAnchorId(filePath, targetLine);
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 60;

    function attempt() {
      if (cancelled) return;
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (attempts < maxAttempts) {
        attempts++;
        requestAnimationFrame(attempt);
      }
    }
    requestAnimationFrame(attempt);
    return () => {
      cancelled = true;
    };
  }, [selAnchor, externalScrollToLine, filePath]);

  // Ctrl+C — copy selected lines
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "c") return;
      if (selStart === null || selEnd === null) return;
      e.preventDefault();
      const lines = plainLines.slice(
        selStart - startLine,
        selEnd - startLine + 1,
      );
      navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [selStart, selEnd, plainLines, startLine]);

  // Clear selection when clicking outside
  useEffect(() => {
    if (selAnchor === null) return;
    const handler = (e: MouseEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setSelAnchor(null);
        setSelHead(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selAnchor]);

  // Esc — clear selection
  useEffect(() => {
    if (selAnchor === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelAnchor(null);
        setSelHead(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selAnchor]);

  // End drag on mouseup anywhere
  useEffect(() => {
    if (!dragging) return;
    const handler = () => setDragging(false);
    document.addEventListener("mouseup", handler);
    return () => document.removeEventListener("mouseup", handler);
  }, [dragging]);

  // ---------------------------------------------------------------------------
  // Action button helpers
  // ---------------------------------------------------------------------------

  const getSelectedText = useCallback((): string => {
    if (selStart === null || selEnd === null) return "";
    return plainLines
      .slice(selStart - startLine, selEnd - startLine + 1)
      .join("\n");
  }, [selStart, selEnd, plainLines, startLine]);

  // The last line in the selection (in document order) — action buttons are
  // rendered after this row, matching DiffView's pattern.
  const actionRowLine =
    selStart !== null && selEnd !== null ? selEnd : selAnchor;

  return (
    <div
      ref={containerRef}
      className={cn("relative group/codeblock", className)}
      tabIndex={-1}
    >
      {/* Wrap toggle — only shown when there are long lines */}
      {hasLongLines && (
        <div className="absolute top-1.5 right-2 z-10 opacity-0 group-hover/codeblock:opacity-100 transition-opacity duration-150">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={toggleWrap}
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
        </div>
      )}

      <SyncedScrollArea
        className={cn(
          "text-[13px] leading-[1.6] font-mono [&::-webkit-scrollbar]:hidden",
          !wordWrap && "overflow-x-auto",
        )}
      >
        <table className="w-full border-collapse table-fixed">
          <tbody>
            {(tokens ?? plainLines).map((line, i) => {
              const lineNum = startLine + i;
              const isHighlighted = highlightLines?.has(lineNum);
              const isSelected = isLineSelected(lineNum);
              const isLastSelected = lineNum === actionRowLine;
              const anchorId = filePath
                ? codeLineAnchorId(filePath, lineNum)
                : undefined;

              return (
                <>
                  <tr
                    key={lineNum}
                    id={anchorId}
                    data-line={lineNum}
                    className={cn(
                      "group/line",
                      isHighlighted && "bg-yellow-500/10 dark:bg-yellow-400/10",
                      isSelected && "bg-blue-500/10 dark:bg-blue-400/10",
                    )}
                    onMouseEnter={() => {
                      if (dragging) setSelHead(lineNum);
                    }}
                  >
                    {/* Line number gutter */}
                    {showLineNumbers && (
                      <td
                        className={cn(
                          "select-none text-right align-top px-3 py-0",
                          "transition-colors duration-75",
                          "sticky left-0",
                          isSelected
                            ? "bg-blue-500/10 dark:bg-blue-400/10 text-blue-600/70 dark:text-blue-400/70 cursor-pointer"
                            : isHighlighted
                              ? "bg-yellow-500/10 dark:bg-yellow-400/10 text-muted-foreground/40 group-hover/line:text-muted-foreground/70"
                              : "bg-background text-muted-foreground/40 group-hover/line:text-muted-foreground/70 cursor-pointer",
                        )}
                        style={{ width: `${gutterWidth + 2}ch` }}
                        onMouseDown={(e) => {
                          if (!showLineNumbers) return;
                          e.preventDefault(); // prevent browser text selection
                          if (e.shiftKey && selAnchor !== null) {
                            setSelHead(lineNum);
                          } else {
                            // Toggle off if clicking the only selected line
                            if (selStart === lineNum && selEnd === lineNum) {
                              setSelAnchor(null);
                              setSelHead(null);
                              return;
                            }
                            setSelAnchor(lineNum);
                            setSelHead(lineNum);
                            setDragging(true);
                          }
                        }}
                      >
                        {lineNum}
                      </td>
                    )}

                    {/* Code content */}
                    <td
                      className={cn(
                        "px-4 py-0",
                        wordWrap
                          ? "whitespace-pre-wrap break-words"
                          : "whitespace-pre",
                      )}
                      style={
                        wordWrap && indentWidths[i] > 0
                          ? {
                              paddingLeft: `calc(1rem + ${indentWidths[i]}ch)`,
                              textIndent: `-${indentWidths[i]}ch`,
                            }
                          : undefined
                      }
                    >
                      {Array.isArray(line) ? (
                        // Highlighted tokens
                        (line as ThemedToken[]).map((token, j) => (
                          <span key={j} style={{ color: token.color }}>
                            {token.content}
                          </span>
                        ))
                      ) : (
                        // Plain text fallback
                        <span className="text-foreground/85">
                          {line as string}
                        </span>
                      )}
                      {/* Ensure empty lines still have height */}
                      {((Array.isArray(line) &&
                        (line as ThemedToken[]).length === 0) ||
                        (!Array.isArray(line) && (line as string) === "")) && (
                        <span>{"\n"}</span>
                      )}
                    </td>
                  </tr>

                  {/* Action buttons row — rendered after the last selected line */}
                  {isLastSelected &&
                    selStart !== null &&
                    selEnd !== null &&
                    filePath && (
                      <tr key={`${lineNum}-actions`} className="h-0">
                        <td
                          colSpan={showLineNumbers ? 2 : 1}
                          className="p-0 relative"
                        >
                          <div className="absolute right-2 -top-3 z-20 flex items-center gap-0.5 bg-background border border-border/60 rounded shadow-sm px-1 py-0.5">
                            <CopyButton getText={getSelectedText} />
                            <PermalinkButton
                              filePath={filePath}
                              startLine={selStart}
                              endLine={selEnd}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                </>
              );
            })}
          </tbody>
        </table>
      </SyncedScrollArea>
    </div>
  );
});
