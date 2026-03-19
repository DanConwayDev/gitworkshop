import { lazy, Suspense } from "react";
import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import { UserLink } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  GitBranch,
  Globe,
  Copy,
  Check,
  Users,
  Tag,
  Radio,
  ExternalLink,
  GitCommit,
  BookOpen,
  AlertCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useGitRepoData, type GitRepoWarning } from "@/hooks/useGitRepoData";
import { useRepositoryState } from "@/hooks/useRepositoryState";
import type { RepositoryState } from "@/casts/RepositoryState";
import { formatDistanceToNow } from "date-fns";

const MarkdownContent = lazy(() => import("@/components/MarkdownContent"));

export default function RepoAboutPage() {
  const { resolved } = useRepoContext();
  const repo = resolved?.repo;

  const repoState = useRepositoryState(
    repo?.dTag,
    repo?.maintainerSet,
    resolved?.repoRelayGroup,
  );

  const gitData = useGitRepoData(repo?.cloneUrls ?? [], {
    knownHeadCommit: repoState?.headCommitId,
    stateCreatedAt: repoState ? repoState.event.created_at : undefined,
  });

  useSeoMeta({
    title: repo ? `${repo.name} - ngit` : "Repository - ngit",
    description: repo?.description ?? "Repository details",
  });

  if (!repo) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Main content */}
        <div className="space-y-6">
          {/* State sync warning banner */}
          {repo.cloneUrls.length > 0 && (
            <StateSyncWarning warning={gitData.warning} />
          )}

          {/* Latest commit */}
          {repo.cloneUrls.length > 0 && (
            <LatestCommitCard gitData={gitData} repoState={repoState} />
          )}

          {/* README */}
          {repo.cloneUrls.length > 0 && <ReadmeCard gitData={gitData} />}

          {/* Description (shown when no README) */}
          {!gitData.readmeContent && repo.description && (
            <Card>
              <CardContent className="p-6">
                <p className="text-base leading-relaxed text-foreground/90">
                  {repo.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Clone URLs */}
          {repo.cloneUrls.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  Clone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {repo.cloneUrls.map((url) => (
                  <CloneUrlRow key={url} url={url} />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Web URLs */}
          {repo.webUrls.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  Web
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {repo.webUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    {url}
                  </a>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Maintainers */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Maintainers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {repo.maintainerSet.map((pk) => (
                <UserLink
                  key={pk}
                  pubkey={pk}
                  avatarSize="md"
                  nameClassName="text-sm"
                />
              ))}
              {repo.pendingMaintainers.length > 0 && (
                <>
                  <Separator />
                  <p className="text-xs text-muted-foreground">
                    Pending (no announcement)
                  </p>
                  {repo.pendingMaintainers.map((pk) => (
                    <UserLink
                      key={pk}
                      pubkey={pk}
                      avatarSize="sm"
                      nameClassName="text-xs text-muted-foreground"
                    />
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          {/* Labels */}
          {repo.labels.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  Topics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {repo.labels.map((label) => (
                    <Badge key={label} variant="secondary" className="text-xs">
                      {label}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Relays */}
          {repo.relays.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Radio className="h-4 w-4 text-muted-foreground" />
                  Relays
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {repo.relays.map((relay) => (
                    <p
                      key={relay}
                      className="text-xs text-muted-foreground font-mono truncate"
                      title={relay}
                    >
                      {relay}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// State sync warning banner
// ---------------------------------------------------------------------------

function StateSyncWarning({ warning }: { warning: GitRepoWarning | null }) {
  if (!warning) return null;

  if (warning.kind === "state-commit-unavailable") {
    const shortState = warning.stateCommitId.slice(0, 8);
    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-0.5">
          <p className="font-medium">State event commit unavailable</p>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
            The state event declares HEAD at{" "}
            <code className="font-mono">{shortState}</code>, but this commit
            could not be found on any git server. Showing the latest available
            commit instead.
          </p>
        </div>
      </div>
    );
  }

  if (warning.kind === "state-behind-git") {
    const shortState = warning.stateCommitId.slice(0, 8);
    const shortGit = warning.gitCommitId.slice(0, 8);
    const stateAge = formatDistanceToNow(
      new Date(warning.stateCreatedAt * 1000),
      { addSuffix: true },
    );
    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-0.5">
          <p className="font-medium">State event is behind git server</p>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
            The state event (published {stateAge}) declares HEAD at{" "}
            <code className="font-mono">{shortState}</code>, but the git server
            reports a newer HEAD at{" "}
            <code className="font-mono">{shortGit}</code>. Showing the latest
            commit from the git server.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Latest commit card
// ---------------------------------------------------------------------------

function LatestCommitCard({
  gitData,
  repoState,
}: {
  gitData: ReturnType<typeof useGitRepoData>;
  repoState: RepositoryState | null | undefined;
  // repoState is used only for branch name and "confirmed" badge — warning
  // logic has moved into useGitRepoData and is surfaced via gitData.warning.
}) {
  if (gitData.loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
            <Skeleton className="h-4 w-64" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (gitData.error || !gitData.latestCommit) {
    return null;
  }

  const commit = gitData.latestCommit;
  const shortHash = commit.hash.slice(0, 8);
  const subject = commit.message.split("\n")[0];
  const authorDate = new Date(commit.author.timestamp * 1000);
  const relativeTime = formatDistanceToNow(authorDate, { addSuffix: true });

  // Determine whether the state event confirms this commit as HEAD
  const stateHeadCommit = repoState?.headCommitId;
  const isConfirmedByState =
    stateHeadCommit !== undefined &&
    (commit.hash.startsWith(stateHeadCommit) ||
      stateHeadCommit.startsWith(commit.hash));
  const stateBranch = repoState?.headBranch;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-muted-foreground" />
          Latest commit
          {stateBranch && (
            <span className="ml-auto text-xs font-normal text-muted-foreground flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {stateBranch}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-start gap-3">
          <code className="shrink-0 text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground mt-0.5">
            {shortHash}
          </code>
          <div className="min-w-0 flex-1">
            <p
              className="text-sm font-medium leading-snug truncate"
              title={subject}
            >
              {subject}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {commit.author.name} &middot; {relativeTime}
              {isConfirmedByState && (
                <span className="ml-2 text-green-600 dark:text-green-400">
                  &middot; confirmed by state event
                </span>
              )}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// README card
// ---------------------------------------------------------------------------

function ReadmeCard({
  gitData,
}: {
  gitData: ReturnType<typeof useGitRepoData>;
}) {
  if (gitData.loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <Skeleton className="h-4 w-24" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (gitData.error) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Could not load repository data: {gitData.error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!gitData.readmeContent) {
    return null;
  }

  const isMarkdown =
    gitData.readmeFilename?.toLowerCase().endsWith(".md") ||
    gitData.readmeFilename?.toLowerCase().endsWith(".markdown");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          {gitData.readmeFilename ?? "README"}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isMarkdown ? (
          <Suspense
            fallback={
              <div className="space-y-2">
                <div className="h-4 animate-pulse bg-muted rounded w-full" />
                <div className="h-4 animate-pulse bg-muted rounded w-5/6" />
                <div className="h-4 animate-pulse bg-muted rounded w-4/6" />
              </div>
            }
          >
            <MarkdownContent content={gitData.readmeContent} />
          </Suspense>
        ) : (
          <pre className="text-sm whitespace-pre-wrap font-mono text-foreground/80 leading-relaxed">
            {gitData.readmeContent}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Clone URL row
// ---------------------------------------------------------------------------

function CloneUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <code className="flex-1 text-sm font-mono truncate text-foreground/80">
        {url}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}
