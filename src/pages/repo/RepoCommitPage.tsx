import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useRepoContext } from "./RepoContext";
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
import { formatDistanceToNow, format } from "date-fns";
import { getSingleCommit } from "@fiatjaf/git-natural-api";
import type { Commit } from "@fiatjaf/git-natural-api";

export default function RepoCommitPage() {
  const { cloneUrls, commitId } = useRepoContext();

  const basePath = useMemo(() => {
    const pathname = window.location.pathname;
    const idx = pathname.indexOf("/commit/");
    return idx !== -1 ? pathname.slice(0, idx) : pathname;
  }, []);

  const [commit, setCommit] = useState<Commit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!commitId || cloneUrls.length === 0) {
      setLoading(false);
      return;
    }

    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setCommit(null);

    Promise.any(cloneUrls.map((url) => getSingleCommit(url, commitId)))
      .then((c) => {
        if (abort.signal.aborted) return;
        setCommit(c);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setLoading(false);
      });

    return () => abort.abort();
  }, [cloneUrls.join(","), commitId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!commitId) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <Card className="border-destructive/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>No commit ID specified.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6 space-y-4">
      {/* Back link */}
      <Link
        to={`${basePath}/commits`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All commits
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
        <CommitDetail commit={commit} basePath={basePath} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commit detail
// ---------------------------------------------------------------------------

function CommitDetail({
  commit,
  basePath,
}: {
  commit: Commit;
  basePath: string;
}) {
  const [copied, setCopied] = useState(false);

  const authorTs = commit.author.timestamp * 1000;
  const committerTs =
    (commit.committer?.timestamp ?? commit.author.timestamp) * 1000;
  const subject = commit.message.split("\n")[0];
  const body = commit.message.split("\n").slice(2).join("\n").trim();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(commit.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Commit header card */}
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
                  title={format(new Date(authorTs), "PPpp")}
                >
                  {formatDistanceToNow(new Date(authorTs), { addSuffix: true })}
                </p>
              </div>
            </div>

            {/* Committer (if different from author) */}
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
                      title={format(new Date(committerTs), "PPpp")}
                    >
                      {formatDistanceToNow(new Date(committerTs), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              )}
          </div>

          {/* Commit hash + parents */}
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

      {/* No diff notice */}
      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Diff view is not yet available. Use{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              git show {commit.hash.slice(0, 8)}
            </code>{" "}
            locally to see the changes.
          </p>
        </CardContent>
      </Card>
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
