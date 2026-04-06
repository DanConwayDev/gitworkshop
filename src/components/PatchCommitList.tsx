/**
 * PatchCommitList — renders a list of commits derived from a NIP-34 patch chain.
 *
 * Each patch in the chain represents one commit. When the patch includes
 * `commit`, `parent-commit`, and `committer` tags, we display the git commit
 * metadata. Otherwise we fall back to the patch subject and event timestamp.
 *
 * Commit links point to `<basePath>/commit/<hash>` when a commit ID is
 * available, matching the same pattern as CommitList for PRs.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Clock, User, GitCommit, Info, AlertTriangle } from "lucide-react";
import { safeFormatDistanceToNow, safeFormat } from "@/lib/utils";
import { eventIdToNevent } from "@/lib/routeUtils";
import type { Patch } from "@/casts/Patch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the committer tag from a patch event.
 * Format: ["committer", "<name>", "<email>", "<timestamp>", "<timezone>"]
 */
function parseCommitterTag(
  patch: Patch,
): { name: string; email: string; timestamp: number } | undefined {
  const tag = patch.event.tags.find(([t]) => t === "committer");
  if (!tag) return undefined;
  const [, name, email, tsStr] = tag;
  if (!name || !tsStr) return undefined;
  const timestamp = parseInt(tsStr, 10);
  if (isNaN(timestamp)) return undefined;
  return { name, email: email ?? "", timestamp };
}

// ---------------------------------------------------------------------------
// PatchCommitList
// ---------------------------------------------------------------------------

export function PatchCommitList({
  patches,
  basePath,
  relayHints,
  isBaseGuessed = false,
  applyResult,
}: {
  /** Ordered patches in the latest revision (oldest first). */
  patches: Patch[];
  /** Prefix for commit links — links become `<basePath>/commit/<nevent1>`. */
  basePath: string;
  /**
   * Relay hints to embed in nevent1 identifiers for patch commit links.
   * Typically the repo relay group URLs.
   */
  relayHints?: string[];
  /**
   * When true, the merge base was approximated because the patch events omit
   * the `parent-commit` tag. Combined with `applyResult` to determine the
   * right banner to show.
   */
  isBaseGuessed?: boolean;
  /**
   * The result of attempting to apply the patch chain from PatchFilesTab.
   * When undefined, the apply hasn't run yet (e.g. user hasn't visited the
   * Files tab). When provided, used to show the accurate outcome banner.
   */
  applyResult?: {
    failedCount: number;
    failureReason?: "no-base" | "fetch-failed" | "hunk-mismatch";
  };
}) {
  // Group by date (using committer timestamp or event created_at)
  const grouped = useMemo(() => {
    const groups: { date: string; patches: Patch[] }[] = [];
    let currentDate = "";

    // Render oldest first (natural patch chain order), skipping cover letters
    for (const patch of patches.filter((p) => !p.isCoverLetter)) {
      const committer = parseCommitterTag(patch);
      const ts = committer?.timestamp ?? patch.event.created_at;
      const dateStr = safeFormat(ts, "MMMM d, yyyy") ?? "Unknown date";
      if (dateStr !== currentDate) {
        currentDate = dateStr;
        groups.push({ date: dateStr, patches: [] });
      }
      groups[groups.length - 1].patches.push(patch);
    }

    return groups;
  }, [patches]);

  // Determine which banner to show based on what we know.
  // applyResult is only available after the user has visited the Files tab.
  const applyFailed = applyResult && applyResult.failedCount > 0;
  const applyClean = applyResult && applyResult.failedCount === 0;

  return (
    <div className="space-y-6">
      {/* Apply failed — amber warning, mirrors PatchFilesTab */}
      {isBaseGuessed && applyFailed && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              These patches omit the{" "}
              <code className="rounded bg-amber-500/10 px-1 font-mono text-[11px]">
                parent-commit
              </code>{" "}
              tag — the merge base was approximated from the patch timestamp,
              and{" "}
              {applyResult.failedCount === 1
                ? "1 file"
                : `${applyResult.failedCount} files`}{" "}
              could not be cleanly applied against it. The diffs shown on
              individual commits are the raw patch diffs.
            </span>
          </div>
        </div>
      )}
      {/* Apply succeeded with guessed base — blue info */}
      {isBaseGuessed && applyClean && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2.5 text-sm text-blue-700 dark:text-blue-400">
          <div className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>
              These patches omit the{" "}
              <code className="rounded bg-blue-500/10 px-1 font-mono text-[11px]">
                parent-commit
              </code>{" "}
              tag — the merge base was approximated from the patch timestamp.
              The patch applied cleanly against the approximated base.
            </span>
          </div>
        </div>
      )}
      {/* Apply not yet run — blue info, no outcome claim */}
      {isBaseGuessed && !applyResult && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2.5 text-sm text-blue-700 dark:text-blue-400">
          <div className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>
              These patches omit the{" "}
              <code className="rounded bg-blue-500/10 px-1 font-mono text-[11px]">
                parent-commit
              </code>{" "}
              tag — the merge base was approximated from the patch timestamp.
              Visit the Files tab to see whether the patch applies cleanly.
            </span>
          </div>
        </div>
      )}
      {grouped.map((group) => (
        <div key={group.date}>
          <div className="flex items-center gap-3 mb-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {group.date}
            </span>
            <div className="flex-1 h-px bg-border/40" />
          </div>
          <Card className="overflow-hidden">
            <div className="divide-y divide-border/40">
              {group.patches.map((patch) => (
                <PatchCommitRow
                  key={patch.id}
                  patch={patch}
                  basePath={basePath}
                  relayHints={relayHints}
                />
              ))}
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PatchCommitRow
// ---------------------------------------------------------------------------

function PatchCommitRow({
  patch,
  basePath,
  relayHints,
}: {
  patch: Patch;
  basePath: string;
  relayHints?: string[];
}) {
  const committer = parseCommitterTag(patch);
  const ts = committer?.timestamp ?? patch.event.created_at;
  const authorName = committer?.name ?? "(unknown)";
  const commitId = patch.commitId;
  // Always use nevent1 of the patch event ID for the URL segment — this is
  // the canonical Nostr identifier. The router decodes it back to the event ID,
  // and patchMatch handles both event ID and commit hash matching.
  const linkSegment = eventIdToNevent(patch.event.id, relayHints);
  const shortHash = commitId?.slice(0, 8);

  const subject = patch.subject;
  const body = patch.body;

  const relativeTime = safeFormatDistanceToNow(ts, { addSuffix: true });

  const titleContent = (
    <span className="text-sm font-medium hover:text-pink-600 dark:hover:text-pink-400 transition-colors line-clamp-2">
      {subject}
    </span>
  );

  return (
    <div className="px-4 py-3 hover:bg-muted/20 transition-colors group">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link to={`${basePath}/commit/${linkSegment}`}>{titleContent}</Link>
          {body && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {body}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
            <User className="h-3 w-3 shrink-0" />
            <span>{authorName}</span>
            <span>&middot;</span>
            <span title={safeFormat(ts, "PPpp") ?? undefined}>
              {relativeTime}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground/70 border-muted-foreground/20"
                >
                  patch
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Sourced from a Nostr patch event
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Link
            to={`${basePath}/commit/${linkSegment}`}
            className={cn(
              "text-xs bg-muted hover:bg-muted/70 px-2 py-1 rounded transition-colors",
              commitId
                ? "font-mono text-muted-foreground hover:text-foreground"
                : "text-muted-foreground/50 hover:text-muted-foreground",
            )}
            title={
              commitId
                ? undefined
                : "No git commit ID — click to view patch event"
            }
          >
            {shortHash ?? "[unknown]"}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PatchCommitListEmpty (re-exported for convenience)
// ---------------------------------------------------------------------------

export function PatchCommitListEmpty({
  message = "No patches found.",
}: {
  message?: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 text-center">
        <GitCommit className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
