/**
 * Shared commit hash verification badge components.
 *
 * Used in PatchCommitDetailView (full commit page) and PatchCommitList
 * (commits tab row) and EventBodyCard (conversation tab commit list).
 */

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ShieldAlert, Loader2, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommitHashResult } from "@/lib/patch-verify";

// ---------------------------------------------------------------------------
// CopyableHash
// ---------------------------------------------------------------------------

export function CopyableHash({
  label,
  hash,
  className,
}: {
  label: string;
  hash: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [hash]);

  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}: </span>
      <code className={cn("font-mono text-[11px]", className)}>
        {hash.slice(0, 12)}
      </code>
      <button
        onClick={(e) => {
          e.stopPropagation();
          void copy();
        }}
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        title="Copy full hash"
      >
        {copied ? (
          <Check className="h-2.5 w-2.5 text-green-500" />
        ) : (
          <Copy className="h-2.5 w-2.5" />
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MismatchBadge — hover tooltip + click popover
// ---------------------------------------------------------------------------

export function MismatchBadge({
  computed,
  claimed,
}: {
  computed: string;
  claimed: string;
}) {
  return (
    <TooltipProvider delayDuration={400}>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button className="focus:outline-none">
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-4 font-normal gap-1 text-amber-600/70 dark:text-amber-400/70 border-amber-500/20 cursor-pointer"
                >
                  <ShieldAlert className="h-3 w-3" />
                  hash differs
                </Badge>
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Click for details
          </TooltipContent>
        </Tooltip>
        <PopoverContent side="bottom" className="text-xs w-80 space-y-2 p-3">
          <p className="font-medium text-amber-400">Commit hash differs</p>
          <p className="text-muted-foreground leading-relaxed">
            When our tooling applies this patch as a commit it produces a
            different commit ID. The diffs apply correctly but there must be
            cosmetic differences (GPG signatures, whitespace, timezone
            encoding).
          </p>
          <div className="pt-0.5 space-y-1">
            <CopyableHash
              label="claimed"
              hash={claimed}
              className="text-foreground/80"
            />
            <CopyableHash
              label="computed"
              hash={computed}
              className="text-amber-400/90"
            />
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// CommitHashBadge — renders the right badge for a given result state
// ---------------------------------------------------------------------------

export function CommitHashBadge({
  result,
}: {
  result: CommitHashResult | "computing" | null;
}) {
  if (!result) return null;

  if (result === "computing") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 py-0 h-4 font-normal gap-1 text-muted-foreground/60 border-muted-foreground/20"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        checking
      </Badge>
    );
  }

  if (result.status === "mismatch") {
    return (
      <MismatchBadge computed={result.computed} claimed={result.claimed} />
    );
  }

  // match or unavailable — no badge
  return null;
}
