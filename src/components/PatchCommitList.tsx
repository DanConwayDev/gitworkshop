/**
 * PatchCommitList — renders a list of commits derived from a NIP-34 patch chain.
 *
 * Each patch in the chain represents one commit. When the patch includes
 * `commit`, `parent-commit`, and `committer` tags, we display the git commit
 * metadata. Otherwise we fall back to the patch subject and event timestamp.
 *
 * Commit links point to `<basePath>/commit/<hash>` when a commit ID is
 * available, matching the same pattern as CommitList for PRs.
 *
 * When `pool` is provided, the full chain is verified once and a "hash differs"
 * badge is shown per row where the computed commit ID doesn't match the claimed one.
 */

import { useEffect, useRef, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Clock, User, GitCommit } from "lucide-react";
import { safeFormatDistanceToNow, safeFormat } from "@/lib/utils";
import { CommitHashBadge } from "@/components/CommitHashBadge";
import {
  verifyPatchChainCommitHashes,
  type CommitHashResult,
} from "@/lib/patch-verify";
import type { Patch } from "@/casts/Patch";
import type { GitGraspPool } from "@/lib/git-grasp-pool";

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
  pool,
  poolWinnerUrl,
  fallbackUrls,
  hashResults: externalHashResults,
}: {
  /** Ordered patches in the latest revision (oldest first). */
  patches: Patch[];
  /** Prefix for commit links — links become `<basePath>/commit/<hash>`. */
  basePath: string;
  /** GitGraspPool for commit hash verification. Optional. */
  pool?: GitGraspPool | null;
  /** Reactive dependency — re-triggers verification when pool connects. */
  poolWinnerUrl?: string | null;
  /** Extra clone URLs to try for fetching data. */
  fallbackUrls?: string[];
  /**
   * Pre-computed hash results keyed by patch event ID. When provided, the
   * component uses these directly and skips running its own verification.
   */
  hashResults?: Map<string, CommitHashResult | "computing">;
}) {
  // Internal verification state — only used when externalHashResults is not provided
  const [internalHashResults, setInternalHashResults] = useState<
    Map<string, CommitHashResult | "computing">
  >(new Map());

  const abortRef = useRef<AbortController | null>(null);
  const prevWinnerRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // Skip internal verification when results are provided externally
    if (externalHashResults !== undefined) return;

    if (!pool || patches.length === 0) {
      setInternalHashResults(new Map());
      return;
    }

    const winnerChanged = poolWinnerUrl !== prevWinnerRef.current;
    prevWinnerRef.current = poolWinnerUrl;

    const allDefinitive =
      internalHashResults.size > 0 &&
      [...internalHashResults.values()].every(
        (r) =>
          r !== "computing" &&
          (r.status === "match" || r.status === "mismatch"),
      );
    if (!winnerChanged && allDefinitive) return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setInternalHashResults((prev) => {
      const next = new Map(prev);
      for (const p of patches) {
        if (p.commitId) next.set(p.event.id, "computing");
      }
      return next;
    });

    verifyPatchChainCommitHashes(patches, pool, abort.signal, fallbackUrls)
      .then((results) => {
        if (abort.signal.aborted) return;
        setInternalHashResults(results);
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        setInternalHashResults(new Map());
      });

    return () => {
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    externalHashResults,
    pool,
    poolWinnerUrl,
    patches,
    fallbackUrls?.join(","),
  ]);

  const hashResults = externalHashResults ?? internalHashResults;

  // Group by date (using committer timestamp or event created_at)
  const grouped = useMemo(() => {
    const groups: { date: string; patches: Patch[] }[] = [];
    let currentDate = "";

    // Render newest first (reverse the oldest-first chain), skipping cover letters
    for (const patch of [...patches]
      .reverse()
      .filter((p) => !p.isCoverLetter)) {
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

  return (
    <div className="space-y-6">
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
                  hashResult={hashResults.get(patch.event.id) ?? null}
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
  hashResult,
}: {
  patch: Patch;
  basePath: string;
  hashResult: CommitHashResult | "computing" | null;
}) {
  const committer = parseCommitterTag(patch);
  const ts = committer?.timestamp ?? patch.event.created_at;
  const authorName = committer?.name ?? "(unknown)";
  const commitId = patch.commitId;
  const shortHash = commitId?.slice(0, 8);

  const subject = patch.subject;
  const body = patch.body;

  const relativeTime = safeFormatDistanceToNow(ts, { addSuffix: true });

  const titleContent = (
    <span className="text-sm font-medium hover:text-violet-600 dark:hover:text-violet-400 transition-colors line-clamp-2">
      {subject}
    </span>
  );

  return (
    <div className="px-4 py-3 hover:bg-muted/20 transition-colors group">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {commitId ? (
            <Link to={`${basePath}/commit/${commitId}`}>{titleContent}</Link>
          ) : (
            titleContent
          )}
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
          <CommitHashBadge result={hashResult} />
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
          {commitId ? (
            <Link
              to={`${basePath}/commit/${commitId}`}
              className="font-mono text-xs bg-muted hover:bg-muted/70 px-2 py-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            >
              {shortHash}
            </Link>
          ) : (
            <span className="font-mono text-xs bg-muted px-2 py-1 rounded text-muted-foreground">
              <GitCommit className="h-3 w-3 inline" />
            </span>
          )}
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
