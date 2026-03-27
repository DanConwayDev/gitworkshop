/**
 * CodeBlock — syntax-highlighted code viewer with line numbers.
 *
 * Uses shiki for accurate TextMate-grammar highlighting (same as VS Code).
 * The highlighter is loaded lazily on first render; while loading, the raw
 * text is shown in a plain <pre> with line numbers so there's no layout
 * shift.
 *
 * Designed for future line-level commenting: each line is a discrete DOM
 * element with a data-line attribute that can be targeted for click handlers
 * and comment anchors.
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
import { WrapText, ArrowRightToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Columns beyond this threshold mean the file has long lines worth wrapping. */
const LONG_LINE_THRESHOLD = 120;

export const CodeBlock = memo(function CodeBlock({
  code,
  filename,
  language,
  startLine = 1,
  className,
  showLineNumbers = true,
  highlightLines,
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
        <table className="w-full border-collapse">
          <tbody>
            {(tokens ?? plainLines).map((line, i) => {
              const lineNum = startLine + i;
              const isHighlighted = highlightLines?.has(lineNum);

              return (
                <tr
                  key={lineNum}
                  data-line={lineNum}
                  className={cn(
                    "group",
                    isHighlighted && "bg-yellow-500/10 dark:bg-yellow-400/10",
                  )}
                >
                  {/* Line number gutter */}
                  {showLineNumbers && (
                    <td
                      className={cn(
                        "select-none text-right align-top px-3 py-0",
                        "text-muted-foreground/40 group-hover:text-muted-foreground/70",
                        "transition-colors duration-75",
                        "sticky left-0 bg-background",
                        isHighlighted &&
                          "bg-yellow-500/10 dark:bg-yellow-400/10",
                      )}
                      style={{ minWidth: `${gutterWidth + 2}ch` }}
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
              );
            })}
          </tbody>
        </table>
      </SyncedScrollArea>
    </div>
  );
});
