import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useRepoContext } from "./RepoContext";
import { useCommitHistory } from "@/hooks/useGitExplorer";
import { useGitExplorer } from "@/hooks/useGitExplorer";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, GitCommit, User, Clock } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { Commit } from "@fiatjaf/git-natural-api";

export default function RepoCommitsPage() {
  const { cloneUrls, repoState } = useRepoContext();

  // First resolve the default ref via getInfoRefs
  const explorer = useGitExplorer(cloneUrls, {
    knownHeadCommit: repoState?.headCommitId,
  });

  const defaultRef = explorer.resolvedRef ?? undefined;

  const history = useCommitHistory(cloneUrls, defaultRef, 50);

  // Build base path for commit links
  const basePath = useMemo(() => {
    const pathname = window.location.pathname;
    const idx = pathname.indexOf("/commits");
    return idx !== -1 ? pathname.slice(0, idx) : pathname;
  }, []);

  if (cloneUrls.length === 0) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              This repository has no clone URLs configured.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <GitCommit className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {defaultRef ? (
            <>
              Commits on{" "}
              <code className="font-mono text-violet-600 dark:text-violet-400">
                {defaultRef}
              </code>
            </>
          ) : (
            "Commits"
          )}
        </h2>
      </div>

      {/* Error */}
      {history.error && (
        <Card className="border-destructive/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{history.error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {history.loading && (
        <div className="space-y-px">
          {Array.from({ length: 8 }).map((_, i) => (
            <CommitRowSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Commit list */}
      {!history.loading && history.commits.length > 0 && (
        <CommitList commits={history.commits} basePath={basePath} />
      )}

      {/* Empty */}
      {!history.loading && !history.error && history.commits.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <GitCommit className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No commits found.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commit list grouped by date
// ---------------------------------------------------------------------------

function CommitList({
  commits,
  basePath,
}: {
  commits: Commit[];
  basePath: string;
}) {
  // Group commits by date (YYYY-MM-DD)
  const grouped = useMemo(() => {
    const groups: { date: string; commits: Commit[] }[] = [];
    let currentDate = "";

    for (const commit of commits) {
      const ts =
        (commit.committer?.timestamp ?? commit.author.timestamp) * 1000;
      const dateStr = format(new Date(ts), "MMMM d, yyyy");
      if (dateStr !== currentDate) {
        currentDate = dateStr;
        groups.push({ date: dateStr, commits: [] });
      }
      groups[groups.length - 1].commits.push(commit);
    }

    return groups;
  }, [commits]);

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
    </div>
  );
}

function CommitRow({ commit, basePath }: { commit: Commit; basePath: string }) {
  const ts = (commit.committer?.timestamp ?? commit.author.timestamp) * 1000;
  const subject = commit.message.split("\n")[0];
  const body = commit.message.split("\n").slice(1).join("\n").trim();
  const shortHash = commit.hash.slice(0, 8);
  const relativeTime = formatDistanceToNow(new Date(ts), { addSuffix: true });

  return (
    <div className="px-4 py-3 hover:bg-muted/20 transition-colors group">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to={`${basePath}/commit/${commit.hash}`}
            className="text-sm font-medium hover:text-violet-600 dark:hover:text-violet-400 transition-colors line-clamp-2"
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
            <span title={format(new Date(ts), "PPpp")}>{relativeTime}</span>
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

function CommitRowSkeleton() {
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
