/**
 * PatchCommitDetailView — commit detail view for patch-sourced commits.
 *
 * Renders the same visual structure as CommitDetailView but uses data
 * extracted from NIP-34 patch events instead of fetching from a git server.
 * The diff comes from the patch's embedded format-patch content, not from
 * tree-based diffing.
 *
 * Features:
 *   - Subtle banner indicating this commit is sourced from a Nostr patch event
 *   - Full commit hash verification (fetches parent tree, applies patch,
 *     rebuilds tree, computes commit hash)
 *   - Verification reason shown inline when unavailable (not hidden in tooltip)
 *   - Smart parent commit links: links to repo commit page when parent is on
 *     the default branch, to PR-scoped page when parent is another patch
 *   - "View raw event" button linking to the Nostr event
 */

import { useEffect, useMemo, useRef, useState } from "react";
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
  ExternalLink,
  GitBranch,
} from "lucide-react";
import { safeFormatDistanceToNow, safeFormat } from "@/lib/utils";
import { DiffView } from "@/components/DiffView";
import {
  verifyPatchCommitHash,
  type CommitHashResult,
} from "@/lib/patch-verify";
import { nip19 } from "nostr-tools";
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
  /** True while the pool is still connecting to git servers. */
  poolLoading?: boolean;
  /** Extra clone URLs to try for fetching data. */
  fallbackUrls?: string[];
  /** Prefix for PR-scoped commit links: `${basePath}/commit/${hash}` */
  basePath: string;
  /** Repo base path for linking to repo-level commits (not PR-scoped). */
  repoBasePath: string;
  /** href for the back navigation link */
  backTo: string;
  /** Label for the back navigation link */
  backLabel?: string;
  /** Whether the commit has a real git commit ID (vs event ID placeholder) */
  hasCommitId?: boolean;
  /** All patches in the current chain (for determining parent context). */
  patchChain?: Patch[];
  /** HEAD commit hash of the default branch (for parent context). */
  defaultBranchHead?: string;
}

// ---------------------------------------------------------------------------
// Parent commit context
// ---------------------------------------------------------------------------

type ParentContext =
  | { kind: "patch-chain"; commitId: string; href: string }
  | { kind: "default-branch"; commitId: string; href: string }
  | { kind: "unknown"; commitId: string };

function resolveParentContext(
  parentCommitId: string,
  basePath: string,
  repoBasePath: string,
  patchChain: Patch[] | undefined,
  _defaultBranchHead: string | undefined,
): ParentContext {
  // Check if parent is another patch in the chain
  if (patchChain) {
    const parentPatch = patchChain.find((p) => p.commitId === parentCommitId);
    if (parentPatch) {
      return {
        kind: "patch-chain",
        commitId: parentCommitId,
        href: `${basePath}/commit/${parentCommitId}`,
      };
    }
  }

  // If the parent is the default branch HEAD, or we just assume it's on the
  // repo (since the git server should have it), link to the repo commit page
  return {
    kind: "default-branch",
    commitId: parentCommitId,
    href: `${repoBasePath}/commit/${parentCommitId}`,
  };
}

// ---------------------------------------------------------------------------
// Commit hash verification badge
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
            tree + applied patch and the computed hash matches.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (result.status === "mismatch") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 py-0 h-4 font-normal gap-1 text-amber-600/70 dark:text-amber-400/70 border-amber-500/20"
      >
        <ShieldAlert className="h-3 w-3" />
        mismatch
      </Badge>
    );
  }

  // unavailable — no badge, reason shown inline below
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatchCommitDetailView({
  commit,
  patchDiff,
  patch,
  pool,
  poolLoading,
  fallbackUrls,
  basePath,
  repoBasePath,
  backTo,
  backLabel = "All commits",
  hasCommitId = true,
  patchChain,
  defaultBranchHead,
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

  // Resolve parent commit context
  const parentContexts = useMemo(() => {
    if (!commit.parents || commit.parents.length === 0) return [];
    return commit.parents.map((parentId) =>
      resolveParentContext(
        parentId,
        basePath,
        repoBasePath,
        patchChain,
        defaultBranchHead,
      ),
    );
  }, [commit.parents, basePath, repoBasePath, patchChain, defaultBranchHead]);

  // Build nevent1 for the raw event link
  const neventId = useMemo(() => {
    try {
      return nip19.neventEncode({ id: patch.event.id });
    } catch {
      return null;
    }
  }, [patch.event.id]);

  // Run commit hash verification in the background.
  // Wait for the pool to finish connecting before starting — otherwise the
  // pool has no URLs to fetch from and verification fails immediately.
  useEffect(() => {
    abortRef.current?.abort();

    if (!hasCommitId || !pool || !patch.commitId || poolLoading) {
      // Show "computing" while pool is still loading (not null — that hides the badge)
      if (poolLoading && hasCommitId && patch.commitId) {
        setCommitHashResult("computing");
      } else {
        setCommitHashResult(null);
      }
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
  }, [hasCommitId, pool, poolLoading, patch.id, fallbackUrls?.join(",")]);

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
        {neventId && (
          <a
            href={`https://njump.me/${neventId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground/80 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            raw event
          </a>
        )}
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
            {/* Commit hash */}
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

            {/* Mismatch: show computed hash */}
            {commitHashResult !== null &&
              commitHashResult !== "computing" &&
              commitHashResult.status === "mismatch" && (
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <Hash className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span className="text-muted-foreground">computed:</span>
                  <code className="font-mono text-amber-600 dark:text-amber-400 break-all">
                    {commitHashResult.computed}
                  </code>
                </div>
              )}

            {/* Unavailable: show reason inline */}
            {commitHashResult !== null &&
              commitHashResult !== "computing" &&
              commitHashResult.status === "unavailable" && (
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <ShieldQuestion className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                  <span className="text-muted-foreground/70">
                    {commitHashResult.reason}
                  </span>
                </div>
              )}

            {/* Parent commits */}
            {parentContexts.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-muted-foreground">
                  {parentContexts.length === 1 ? "Parent:" : "Parents:"}
                </span>
                {parentContexts.map((ctx) => (
                  <span
                    key={ctx.commitId}
                    className="inline-flex items-center gap-1"
                  >
                    {ctx.kind === "unknown" ? (
                      <code className="font-mono text-muted-foreground">
                        {ctx.commitId.slice(0, 8)}
                      </code>
                    ) : (
                      <Link
                        to={ctx.href}
                        className="font-mono text-violet-600 dark:text-violet-400 hover:underline"
                      >
                        {ctx.commitId.slice(0, 8)}
                      </Link>
                    )}
                    {ctx.kind === "patch-chain" && (
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1 py-0 h-3.5 font-normal text-muted-foreground/60 border-muted-foreground/15"
                      >
                        patch
                      </Badge>
                    )}
                    {ctx.kind === "default-branch" && (
                      <span className="inline-flex items-center gap-0.5 text-muted-foreground/60">
                        <GitBranch className="h-3 w-3" />
                        {ctx.commitId === defaultBranchHead && (
                          <span className="text-[9px]">HEAD</span>
                        )}
                      </span>
                    )}
                  </span>
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
