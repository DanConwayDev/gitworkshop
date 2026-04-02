/**
 * Shared commit list display — used by both RepoCommitsPage (branch history)
 * and the PR commits view (range between tip and merge-base).
 *
 * Renders commits grouped by date with links to individual commit pages.
 * The caller supplies `basePath`; commit links become `<basePath>/commit/<hash>`.
 */

import { useMemo, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, GitCommit, User, Clock, Loader2 } from "lucide-react";
import { safeFormatDistanceToNow, safeFormat } from "@/lib/utils";
import type { Commit } from "@fiatjaf/git-natural-api";

// ---------------------------------------------------------------------------
// CommitList — grouped by date
// ---------------------------------------------------------------------------

export function CommitList({
  commits,
  basePath,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: {
  commits: Commit[];
  /** Prefix for commit links — links become `<basePath>/commit/<hash>`. */
  basePath: string;
  /** Whether there are more commits to load. */
  hasMore?: boolean;
  /** True while the next batch is being fetched. */
  loadingMore?: boolean;
  /** Called when the sentinel scrolls into view. */
  onLoadMore?: () => void;
}) {
  const grouped = useMemo(() => {
    const groups: { date: string; commits: Commit[] }[] = [];
    let currentDate = "";

    for (const commit of commits) {
      const dateStr =
        safeFormat(
          commit.committer?.timestamp ?? commit.author.timestamp,
          "MMMM d, yyyy",
        ) ?? "Unknown date";
      if (dateStr !== currentDate) {
        currentDate = dateStr;
        groups.push({ date: dateStr, commits: [] });
      }
      groups[groups.length - 1].commits.push(commit);
    }

    return groups;
  }, [commits]);

  // IntersectionObserver sentinel — fires onLoadMore when visible.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!onLoadMore || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore]);

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
              {group.commits.map((commit) => (
                <CommitRow
                  key={commit.hash}
                  commit={commit}
                  basePath={basePath}
                />
              ))}
            </div>
          </Card>
        </div>
      ))}

      {/* Infinite scroll sentinel */}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {loadingMore && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading more commits…
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommitRow
// ---------------------------------------------------------------------------

export function CommitRow({
  commit,
  basePath,
}: {
  commit: Commit;
  basePath: string;
}) {
  const subject = commit.message.split("\n")[0];
  const body = commit.message.split("\n").slice(1).join("\n").trim();
  const shortHash = commit.hash.slice(0, 8);
  const relativeTime = safeFormatDistanceToNow(
    commit.committer?.timestamp ?? commit.author.timestamp,
    { addSuffix: true },
  );

  return (
    <div className="px-4 py-3 hover:bg-muted/20 transition-colors group">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to={`${basePath}/commit/${commit.hash}`}
            className="text-sm font-medium hover:text-pink-600 dark:hover:text-pink-400 transition-colors line-clamp-2"
          >
            {subject}
          </Link>
          {body && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {body}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
            <User className="h-3 w-3 shrink-0" />
            <span>{commit.author.name}</span>
            <span>&middot;</span>
            <span
              title={
                safeFormat(
                  commit.committer?.timestamp ?? commit.author.timestamp,
                  "PPpp",
                ) ?? undefined
              }
            >
              {relativeTime}
            </span>
          </div>
        </div>
        <Link
          to={`${basePath}/commit/${commit.hash}`}
          className="shrink-0 font-mono text-xs bg-muted hover:bg-muted/70 px-2 py-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          {shortHash}
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommitRowSkeleton
// ---------------------------------------------------------------------------

export function CommitRowSkeleton() {
  return (
    <div className="px-4 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-6 w-16 rounded" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommitListLoading — skeleton rows with spinner header
// ---------------------------------------------------------------------------

export function CommitListLoading({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-px">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading commits…</span>
      </div>
      {Array.from({ length: count }).map((_, i) => (
        <CommitRowSkeleton key={i} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommitListEmpty
// ---------------------------------------------------------------------------

export function CommitListEmpty({
  message = "No commits found.",
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

// ---------------------------------------------------------------------------
// CommitListError
// ---------------------------------------------------------------------------

export function CommitListError({ message }: { message: string }) {
  return (
    <Card className="border-destructive/30">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      </CardContent>
    </Card>
  );
}
