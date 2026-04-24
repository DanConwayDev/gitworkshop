/**
 * CommitHoverCard — wraps a trigger element with a hover card that shows a
 * commit preview (subject, author, date, parent).
 *
 * The commit is fetched lazily when the card opens so we don't pay the
 * network cost for every CommitLink on the page.
 */

import { useState, useEffect, useRef } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { GitCommit, User, Clock, GitMerge } from "lucide-react";
import { safeFormatDistanceToNow, safeFormat } from "@/lib/utils";
import type { Commit } from "@fiatjaf/git-natural-api";
import type { GitGraspPool } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Inner body — only mounted when the card opens
// ---------------------------------------------------------------------------

interface CommitHoverCardBodyProps {
  hash: string;
  pool: GitGraspPool;
}

function CommitHoverCardBody({ hash, pool }: CommitHoverCardBodyProps) {
  const [commit, setCommit] = useState<Commit | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    abortRef.current = abort;

    pool
      .getSingleCommit(hash, abort.signal)
      .then((c) => {
        if (abort.signal.aborted) return;
        setCommit(c ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoading(false);
      });

    return () => abort.abort();
  }, [hash, pool]);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="space-y-1.5 pt-1">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    );
  }

  if (!commit) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Commit not found.</div>
    );
  }

  const subject = commit.message.split("\n")[0];
  const authorTsSecs = commit.author.timestamp;
  const shortHash = commit.hash.slice(0, 7);
  const parentHash = commit.parents?.[0] ?? null;
  const authorDateLabel = safeFormat(authorTsSecs, "PPpp") ?? undefined;

  return (
    <div className="p-4 space-y-3">
      {/* Hash badge */}
      <div className="flex items-center gap-1.5">
        <GitCommit className="h-3.5 w-3.5 text-pink-500 shrink-0" />
        <code className="text-xs font-mono text-pink-600 dark:text-pink-400 bg-pink-500/10 px-1.5 py-0.5 rounded">
          {shortHash}
        </code>
      </div>

      {/* Commit subject */}
      <p className="text-sm font-medium leading-snug line-clamp-3 break-words">
        {subject}
      </p>

      {/* Meta row */}
      <div className="space-y-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <User className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {commit.author.name}
            {commit.author.email && (
              <span className="opacity-70"> &lt;{commit.author.email}&gt;</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 shrink-0" />
          <span title={authorDateLabel}>
            {safeFormatDistanceToNow(authorTsSecs, { addSuffix: true })}
          </span>
        </div>

        {parentHash && (
          <div className="flex items-center gap-1.5">
            <GitMerge className="h-3 w-3 shrink-0" />
            <code className="font-mono opacity-70">
              {parentHash.slice(0, 7)}
            </code>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface CommitHoverCardProps {
  hash: string;
  pool: GitGraspPool;
  children: React.ReactNode;
  /** Pass true when the child is already a single forwardRef element (e.g. a Link) */
  asChild?: boolean;
}

export function CommitHoverCard({
  hash,
  pool,
  children,
  asChild,
}: CommitHoverCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <HoverCard
      openDelay={400}
      closeDelay={150}
      open={open}
      onOpenChange={setOpen}
    >
      <HoverCardTrigger asChild={asChild}>{children}</HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-72 p-0 rounded-2xl overflow-hidden border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {open && <CommitHoverCardBody hash={hash} pool={pool} />}
      </HoverCardContent>
    </HoverCard>
  );
}
