/**
 * WrappableCodeBlock — lightweight pre/code wrapper for embedded code blocks
 * in markdown and comment renderers.
 *
 * Behaviour:
 *   - Mobile: horizontal scroll (swipe-natural, no toggle)
 *   - Desktop: word-wrap on by default, hover-reveal toggle to switch to scroll
 *
 * Intentionally has no line numbers — this is for embedded snippets, not the
 * full file viewer (CodeBlock handles that).
 */
import { useState, useRef, useMemo, useCallback, type ReactNode } from "react";
import { WrapText, ArrowRightToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn, extractText } from "@/lib/utils";

const LONG_LINE_THRESHOLD = 120;

interface WrappableCodeBlockProps {
  children?: ReactNode;
  /** Raw text content — used to decide whether to show the toggle at all */
  rawText?: string;
  className?: string;
}

export function WrappableCodeBlock({
  children,
  rawText,
  className,
}: WrappableCodeBlockProps) {
  const isMobile = useIsMobile();

  // Desktop defaults to wrap; mobile always scrolls (no state needed there)
  const [wordWrap, setWordWrap] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasLongLines = useMemo(() => {
    const text = rawText ?? extractText(children);
    return text.split("\n").some((l) => l.length > LONG_LINE_THRESHOLD);
  }, [rawText, children]);

  const toggleWrap = useCallback(() => setWordWrap((w) => !w), []);

  // Mobile: plain scrollable pre, no toggle
  if (isMobile) {
    return (
      <pre
        className={cn(
          "relative max-w-full overflow-x-auto rounded-lg border border-border bg-muted p-3 text-sm leading-relaxed my-2",
          className,
        )}
      >
        {children}
      </pre>
    );
  }

  // Desktop: wrap by default, toggle on hover when there are long lines
  return (
    <div ref={containerRef} className="relative group/wrappable my-2">
      {hasLongLines && (
        <div className="absolute top-1.5 right-2 z-10 opacity-0 group-hover/wrappable:opacity-100 transition-opacity duration-150">
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
              {wordWrap ? "Disable" : "Enable"} word wrap
            </TooltipContent>
          </Tooltip>
        </div>
      )}
      <pre
        className={cn(
          "max-w-full rounded-lg border border-border bg-muted p-3 text-sm leading-relaxed",
          wordWrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto",
          className,
        )}
      >
        {children}
      </pre>
    </div>
  );
}
