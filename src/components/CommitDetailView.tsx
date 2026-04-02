/**
 * CommitDetailView — shared commit detail UI used by RepoCommitPage and
 * PRCommitPage.
 *
 * Fetches the commit from the pool, renders the header card (author,
 * committer, hash, parent links), and delegates the diff to CommitDiffView.
 *
 * Props:
 *   commitId   — the commit hash to display
 *   pool       — GitGraspPool instance
 *   basePath   — prefix used to build parent commit links
 *                e.g. "/<npub>/<repoId>" → links to "<basePath>/commit/<hash>"
 *   backTo     — href for the "back" link
 *   backLabel  — label for the "back" link (default: "All commits")
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  GitCommit,
  User,
  Clock,
  ArrowLeft,
  Copy,
  Check,
  Hash,
} from "lucide-react";
import { safeFormatDistanceToNow, safeFormat } from "@/lib/utils";
import type { Commit } from "@fiatjaf/git-natural-api";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
import { CommitDiffView } from "@/components/CommitDiffView";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CommitDetailViewProps {
  commitId: string;
  pool: GitGraspPool;
  /** Prefix for parent commit links: `${basePath}/commit/${parentHash}` */
  basePath: string;
  /** href for the back navigation link */
  backTo: string;
  /** Label for the back navigation link */
  backLabel?: string;
  /**
   * Extra URLs to try after the pool's own URLs if commit/blob data is not
   * found there. Not tracked by the pool. Used to pass PR/PR-Update clone
   * URLs when viewing a commit scoped to a PR.
   */
  fallbackUrls?: string[];
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function CommitDetailView({
  commitId,
  pool,
  basePath,
  backTo,
  backLabel = "All commits",
  fallbackUrls,
}: CommitDetailViewProps) {
  const [commit, setCommit] = useState<Commit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setCommit(null);

    pool
      .getSingleCommit(commitId, abort.signal, fallbackUrls)
      .then((c) => {
        if (abort.signal.aborted) return;
        if (!c) {
          setError("Commit not found");
          setLoading(false);
          return;
        }
        setCommit(c);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, commitId, fallbackUrls?.join(",")]);

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

      {/* Error */}
      {error && (
        <Card className="border-destructive/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Failed to load commit: {error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && <CommitDetailSkeleton />}

      {/* Commit detail */}
      {!loading && commit && (
        <CommitDetail
          commit={commit}
          basePath={basePath}
          pool={pool}
          fallbackUrls={fallbackUrls}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commit detail card + diff
// ---------------------------------------------------------------------------

function CommitDetail({
  commit,
  basePath,
  pool,
  fallbackUrls,
}: {
  commit: Commit;
  basePath: string;
  pool: GitGraspPool;
  fallbackUrls?: string[];
}) {
  const [copied, setCopied] = useState(false);

  const authorTs = commit.author.timestamp * 1000;
  const committerTs =
    (commit.committer?.timestamp ?? commit.author.timestamp) * 1000;
  const subject = commit.message.split("\n")[0];
  const body = commit.message.split("\n").slice(2).join("\n").trim();
  const parentHash = commit.parents?.[0] ?? null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(commit.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-pink-500/10 to-pink-500/10 shrink-0">
              <GitCommit className="h-5 w-5 text-pink-500" />
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

          {/* Hash + parent links */}
          <div className="mt-4 pt-3 border-t border-border/40 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <code className="text-xs font-mono text-muted-foreground break-all">
                {commit.hash}
              </code>
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
            </div>

            {commit.parents && commit.parents.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Parents:</span>
                {commit.parents.map((p) => (
                  <Link
                    key={p}
                    to={`${basePath}/commit/${p}`}
                    className="text-xs font-mono text-pink-600 dark:text-pink-400 hover:underline"
                  >
                    {p.slice(0, 8)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Diff */}
      {parentHash ? (
        <CommitDiffView
          tipCommitId={commit.hash}
          baseCommitId={parentHash}
          pool={pool}
          fallbackUrls={fallbackUrls}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
          This is the initial commit — no parent to diff against.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function CommitDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 border-t border-border/40">
          <div className="grid grid-cols-2 gap-4 pt-3">
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
