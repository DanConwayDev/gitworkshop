/**
 * PatchCommitDetailView — commit detail view for patch-sourced commits.
 *
 * Renders the same visual structure as CommitDetailView but uses data
 * extracted from NIP-34 patch events instead of fetching from a git server.
 * The diff comes from the patch's embedded format-patch content, not from
 * tree-based diffing.
 *
 * Features:
 *   - Source banner: "Sourced from a Nostr patch event by Avatar Name timeago {}"
 *   - Full commit hash verification (reactive — retries when pool connects)
 *   - Verification reason shown inline when unavailable
 *   - Smart parent commit links (repo-level vs PR-scoped)
 *   - Raw event JSON modal (Braces icon)
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  GitCommit,
  User,
  Clock,
  ArrowLeft,
  Copy,
  Check,
  Hash,
  ShieldAlert,
  ShieldQuestion,
  Loader2,
  GitBranch,
  Braces,
  RotateCcw,
} from "lucide-react";
import { cn, safeFormatDistanceToNow, safeFormat } from "@/lib/utils";
import { DiffView } from "@/components/DiffView";
import { UserLink } from "@/components/UserAvatar";
import {
  verifyPatchChainCommitHashes,
  readCachedChainResults,
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
  /**
   * The pool's current winner URL. Used as a reactive dependency — when
   * this changes from null to a URL, verification is (re-)triggered.
   */
  poolWinnerUrl?: string | null;
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
  /**
   * When true, a banner is shown indicating this commit belongs to a
   * superseded revision (a newer revision has been pushed).
   */
  superseded?: boolean;
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
): ParentContext {
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

  return {
    kind: "default-branch",
    commitId: parentCommitId,
    href: `${repoBasePath}/commit/${parentCommitId}`,
  };
}

// ---------------------------------------------------------------------------
// Commit hash verification badge
// ---------------------------------------------------------------------------

/**
 * Expandable badge for the "hash differs" case.
 *
 * Concise label by default; clicking opens a tooltip with a fuller explanation
 * of what the mismatch means and why it is cosmetic.
 */
function CopyableHash({
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

function MismatchBadge({
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
        checking
      </Badge>
    );
  }

  if (result.status === "match") {
    return null;
  }

  if (result.status === "mismatch") {
    return (
      <MismatchBadge computed={result.computed} claimed={result.claimed} />
    );
  }

  // unavailable — no badge, reason shown inline below
  return null;
}

// ---------------------------------------------------------------------------
// Raw event JSON modal
// ---------------------------------------------------------------------------

function RawEventJsonDialog({
  event,
  open,
  onOpenChange,
}: {
  event: {
    id: string;
    pubkey: string;
    kind: number;
    created_at: number;
    content: string;
    tags: string[][];
    sig: string;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Patch event JSON</DialogTitle>
        </DialogHeader>
        <div className="overflow-auto rounded-md border bg-muted/40 p-4 min-h-0">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
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
  poolWinnerUrl,
  fallbackUrls,
  basePath,
  repoBasePath,
  backTo,
  backLabel = "All commits",
  hasCommitId = true,
  patchChain,
  defaultBranchHead,
  superseded = false,
}: PatchCommitDetailViewProps) {
  const [copied, setCopied] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const chainToVerify = patchChain ?? [patch];
  const [commitHashResult, setCommitHashResult] = useState<
    CommitHashResult | "computing" | null
  >(() => {
    // Initialise from cache synchronously — avoids a "checking" flash on refresh
    if (!hasCommitId || !patch.commitId) return null;
    const cached = readCachedChainResults(chainToVerify);
    return cached?.get(patch.event.id) ?? null;
  });
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
      resolveParentContext(parentId, basePath, repoBasePath, patchChain),
    );
  }, [commit.parents, basePath, repoBasePath, patchChain]);

  // Run commit hash verification reactively.
  //
  // The pool may not be connected yet when this component first mounts.
  // We depend on poolWinnerUrl so the effect re-runs when the pool
  // establishes a connection. If verification fails because the pool
  // isn't ready, the next poolWinnerUrl change will retry.
  //
  // If verification returns "unavailable" but the pool later connects
  // (poolWinnerUrl changes), we retry — the "unavailable" result might
  // have been due to the pool not being ready.
  const prevWinnerRef = useRef<string | null | undefined>(undefined);
  const fallbackUrlsKey = fallbackUrls?.join(",");

  useEffect(() => {
    // Skip if no commit ID or no pool
    if (!hasCommitId || !patch.commitId || !pool) {
      if (!pool && hasCommitId && patch.commitId) {
        setCommitHashResult("computing");
      } else {
        setCommitHashResult(null);
      }
      return;
    }

    // If we already have a definitive result (match/mismatch) and the
    // winner URL hasn't changed, don't re-run.
    const winnerChanged = poolWinnerUrl !== prevWinnerRef.current;
    prevWinnerRef.current = poolWinnerUrl;

    if (
      !winnerChanged &&
      commitHashResult !== null &&
      commitHashResult !== "computing" &&
      commitHashResult.status !== "unavailable"
    ) {
      return;
    }

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    // Only show "checking" if we don't already have a cached result
    if (
      commitHashResult === null ||
      commitHashResult === "computing" ||
      commitHashResult.status === "unavailable"
    ) {
      setCommitHashResult("computing");
    }

    const run = () => {
      if (abort.signal.aborted) return;
      verifyPatchChainCommitHashes(
        chainToVerify,
        pool,
        abort.signal,
        fallbackUrls,
      )
        .then((results) => {
          if (abort.signal.aborted) return;
          const myResult = results.get(patch.event.id);
          setCommitHashResult(
            myResult ?? {
              status: "unavailable",
              reason: "Verification produced no result for this patch",
            },
          );
        })
        .catch((err) => {
          if (abort.signal.aborted) return;
          setCommitHashResult({
            status: "unavailable",
            reason: err instanceof Error ? err.message : "Verification failed",
          });
        });
    };

    // Defer until the browser is idle so verification doesn't compete with
    // the initial render. Falls back to setTimeout for environments without
    // requestIdleCallback (e.g. Safari < 16).
    const idleId =
      typeof requestIdleCallback !== "undefined"
        ? requestIdleCallback(run, { timeout: 2000 })
        : setTimeout(run, 200);

    return () => {
      abort.abort();
      if (typeof requestIdleCallback !== "undefined") {
        cancelIdleCallback(idleId as number);
      } else {
        clearTimeout(idleId as ReturnType<typeof setTimeout>);
      }
    };
    // commitHashResult is intentionally omitted: it is read only as a guard
    // to avoid redundant re-runs, but adding it would cause an infinite loop
    // because the effect also calls setCommitHashResult.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasCommitId,
    pool,
    poolWinnerUrl,
    patch.id,
    patch.commitId,
    patch.event.id,
    patchChain,
    chainToVerify,
    fallbackUrlsKey,
    fallbackUrls,
  ]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(commit.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const eventCreatedAt = patch.event.created_at;
  const relativeTime = safeFormatDistanceToNow(eventCreatedAt, {
    addSuffix: true,
  });

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
        <span className="text-xs text-muted-foreground">
          Sourced from a Nostr patch event by
        </span>
        <UserLink
          pubkey={patch.pubkey}
          avatarSize="sm"
          nameClassName="text-xs"
        />
        <span
          className="text-xs text-muted-foreground"
          title={safeFormat(eventCreatedAt, "PPpp") ?? undefined}
        >
          {relativeTime}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 ml-auto shrink-0 text-muted-foreground/50 hover:text-foreground"
          title="View raw event JSON"
          onClick={() => setJsonOpen(true)}
        >
          <Braces className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Outdated banner */}
      {superseded && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <RotateCcw className="h-3.5 w-3.5 text-amber-500/70 shrink-0" />
          <span className="text-xs text-amber-600/80 dark:text-amber-400/80">
            This commit is from an outdated revision. A newer revision has been
            pushed for this patch.
          </span>
          <Link
            to={backTo}
            className="ml-auto text-xs text-amber-600/70 dark:text-amber-400/70 hover:text-amber-600 dark:hover:text-amber-400 underline underline-offset-2 shrink-0"
          >
            View latest
          </Link>
        </div>
      )}

      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 shrink-0">
              <GitCommit className="h-5 w-5 text-violet-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold leading-snug break-words">
                {subject}
              </h1>
              {body && (
                <pre className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed break-words">
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

      {/* Raw event JSON modal */}
      <RawEventJsonDialog
        event={patch.event}
        open={jsonOpen}
        onOpenChange={setJsonOpen}
      />
    </div>
  );
}
