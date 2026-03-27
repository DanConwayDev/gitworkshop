/**
 * PatchCommitDetailView — commit detail view for patch-sourced commits.
 *
 * Renders the same visual structure as CommitDetailView but uses data
 * extracted from NIP-34 patch events instead of fetching from a git server.
 * The diff comes from the patch's embedded format-patch content, not from
 * tree-based diffing.
 *
 * Includes:
 *   - A subtle banner indicating this commit is sourced from a Nostr patch event
 *   - Commit hash verification: fetches the parent tree, applies the patch,
 *     rebuilds the tree, and computes the commit hash to compare against the
 *     claimed hash in the patch event's tags
 *   - Shows match/mismatch/computing status next to the commit hash
 *
 * Used by PRCommitPage when the commit doesn't exist on the git server
 * (which is the normal case for patch-type PRs).
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  GitCommit,
  User,
  Clock,
  ArrowLeft,
  Copy,
  Check,
  Hash,
  Radio,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Loader2,
} from "lucide-react";
import { safeFormatDistanceToNow, safeFormat } from "@/lib/utils";
import { DiffView } from "@/components/DiffView";
import {
  verifyPatchCommitHash,
  type CommitHashResult,
} from "@/lib/patch-verify";
import type { Commit } from "@fiatjaf/git-natural-api";
import type { Patch } from "@/casts/Patch";
import type { GitGraspPool } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PatchCommitDetailViewProps {
  /** Synthetic Commit object built from patch metadata. */
  commit: Commit;
  /** Raw unified diff string from the patch event's content. */
  patchDiff: string;
  /** The original Patch cast — needed for commit hash verification. */
  patch: Patch;
  /** GitGraspPool for fetching tree/blob data for verification. */
  pool: GitGraspPool | null;
  /** Extra clone URLs to try for fetching data. */
  fallbackUrls?: string[];
  /** Prefix for parent commit links: `${basePath}/commit/${parentHash}` */
  basePath: string;
  /** href for the back navigation link */
  backTo: string;
  /** Label for the back navigation link */
  backLabel?: string;
  /** Whether the commit has a real git commit ID (vs event ID placeholder) */
  hasCommitId?: boolean;
}

// ---------------------------------------------------------------------------
// Commit hash verification badge (shown next to the hash)
// ---------------------------------------------------------------------------

function CommitHashBadge({
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
        verifying
      </Badge>
    );
  }

  if (result.status === "match") {
    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 font-normal gap-1 text-green-600/70 dark:text-green-400/70 border-green-500/20"
            >
              <ShieldCheck className="h-3 w-3" />
              verified
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-72">
            Commit hash verified. We reconstructed the commit from the parent
            tree + applied patch and the computed hash matches the claimed hash.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (result.status === "mismatch") {
    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 font-normal gap-1 text-amber-600/70 dark:text-amber-400/70 border-amber-500/20"
            >
              <ShieldAlert className="h-3 w-3" />
              mismatch
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-80">
            <p className="mb-1">
              The computed commit hash doesn't match the claimed hash.
            </p>
            <p className="font-mono text-[10px]">
              claimed:{" "}
              <span className="text-foreground">
                {result.claimed.slice(0, 12)}
              </span>
            </p>
            <p className="font-mono text-[10px]">
              computed:{" "}
              <span className="text-foreground">
                {result.computed.slice(0, 12)}
              </span>
            </p>
            <p className="mt-1 opacity-70">
              This can happen due to GPG signatures, different git
              configurations, or modified patch content. The diff is still
              shown.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // unavailable
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 font-normal gap-1 text-muted-foreground/50 border-muted-foreground/15"
          >
            <ShieldQuestion className="h-3 w-3" />
            unverified
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-64">
          {result.reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatchCommitDetailView({
  commit,
  patchDiff,
  patch,
  pool,
  fallbackUrls,
  basePath,
  backTo,
  backLabel = "All commits",
  hasCommitId = true,
}: PatchCommitDetailViewProps) {
  const [copied, setCopied] = useState(false);
  const [commitHashResult, setCommitHashResult] = useState<
    CommitHashResult | "computing" | null
  >(null);
  const abortRef = useRef<AbortController | null>(null);

  const authorTs = commit.author.timestamp * 1000;
  const committerTs =
    (commit.committer?.timestamp ?? commit.author.timestamp) * 1000;
  const subject = commit.message.split("\n")[0];
  const body = commit.message.split("\n").slice(2).join("\n").trim();

  // Run commit hash verification in the background
  useEffect(() => {
    abortRef.current?.abort();

    if (!hasCommitId || !pool || !patch.commitId) {
      setCommitHashResult(null);
      return;
    }

    const abort = new AbortController();
    abortRef.current = abort;
    setCommitHashResult("computing");

    verifyPatchCommitHash(patch, pool, abort.signal, fallbackUrls).then(
      (result) => {
        if (abort.signal.aborted) return;
        setCommitHashResult(result);
      },
    );

    return () => {
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCommitId, pool, patch.id, fallbackUrls?.join(",")]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(commit.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link
        to={backTo}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {backLabel}
      </Link>

      {/* Patch source banner */}
      <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
        <Radio className="h-3.5 w-3.5 text-violet-500 shrink-0" />
        <span className="text-xs text-muted-foreground">
          This commit is sourced from a{" "}
          <span className="font-medium text-foreground/80">
            Nostr patch event
          </span>
          {!hasCommitId && (
            <span>
              {" "}
              — no git commit hash available, showing event data only
            </span>
          )}
        </span>
      </div>

      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 shrink-0">
              <GitCommit className="h-5 w-5 text-violet-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold leading-snug">{subject}</h1>
              {body && (
                <pre className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                  {body}
                </pre>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 border-t border-border/40">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3">
            {/* Author */}
            <div className="flex items-start gap-2">
              <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Author</p>
                <p className="text-sm font-medium">{commit.author.name}</p>
                <p className="text-xs text-muted-foreground">
                  {commit.author.email}
                </p>
                <p
                  className="text-xs text-muted-foreground"
                  title={safeFormat(authorTs / 1000, "PPpp") ?? undefined}
                >
                  {safeFormatDistanceToNow(commit.author.timestamp, {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </div>

            {/* Committer (only when different from author) */}
            {commit.committer &&
              commit.committer.name !== commit.author.name && (
                <div className="flex items-start gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Committed by
                    </p>
                    <p className="text-sm font-medium">
                      {commit.committer.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {commit.committer.email}
                    </p>
                    <p
                      className="text-xs text-muted-foreground"
                      title={
                        safeFormat(committerTs / 1000, "PPpp") ?? undefined
                      }
                    >
                      {safeFormatDistanceToNow(
                        commit.committer?.timestamp ?? commit.author.timestamp,
                        { addSuffix: true },
                      )}
                    </p>
                  </div>
                </div>
              )}
          </div>

          {/* Hash + verification + parent links */}
          <div className="mt-4 pt-3 border-t border-border/40 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <code className="text-xs font-mono text-muted-foreground break-all">
                {hasCommitId
                  ? commit.hash
                  : `(event: ${commit.hash.slice(0, 16)}…)`}
              </code>
              {hasCommitId && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  )}
                </Button>
              )}
              <CommitHashBadge result={commitHashResult} />
            </div>

            {/* Show computed hash when there's a mismatch */}
            {commitHashResult !== null &&
              commitHashResult !== "computing" &&
              commitHashResult.status === "mismatch" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Hash className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    computed:
                  </span>
                  <code className="text-xs font-mono text-amber-600 dark:text-amber-400 break-all">
                    {commitHashResult.computed}
                  </code>
                </div>
              )}

            {commit.parents && commit.parents.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Parents:</span>
                {commit.parents.map((p) => (
                  <Link
                    key={p}
                    to={`${basePath}/commit/${p}`}
                    className="text-xs font-mono text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    {p.slice(0, 8)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Diff from patch content */}
      {patchDiff ? (
        <DiffView diff={patchDiff} />
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
          No diff content available for this patch.
        </div>
      )}
    </div>
  );
}
