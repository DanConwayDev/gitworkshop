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
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useGitPool } from "@/hooks/useGitPool";
import type { PoolState, PoolWarning } from "@/lib/git-grasp-pool";
import type { RepositoryState } from "@/casts/RepositoryState";
import { safeFormatDistanceToNow } from "@/lib/utils";

const MarkdownContent = lazy(() => import("@/components/MarkdownContent"));

export default function RepoAboutPage() {
  const { resolved, repoState, repoRelayEose } = useRepoContext();
  const repo = resolved?.repo;

  const { poolState } = useGitPool(repo?.cloneUrls ?? [], {
    knownHeadCommit: repoState?.headCommitId,
    stateRefs: repoState?.refs,
    stateCreatedAt: repoState ? repoState.event.created_at : undefined,
  });

  // Combined "pull in progress" signal: true while either Nostr hasn't EOSEd
  // yet (we may still receive a newer state event) or the git server fetch is
  // in flight with stale data already shown. Only meaningful when we have
  // clone URLs to check against.
  const pulling =
    repo && repo.cloneUrls.length > 0
      ? !repoRelayEose || poolState.pulling
      : false;

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
            <StateSyncWarning warning={poolState.warning} pulling={pulling} />
          )}

          {/* Latest commit */}
          {repo.cloneUrls.length > 0 && (
            <LatestCommitCard
              poolState={poolState}
              repoState={repoState}
              pulling={pulling}
            />
          )}

          {/* README */}
          {repo.cloneUrls.length > 0 && <ReadmeCard poolState={poolState} />}

          {/* Description (shown when no README) */}
          {!poolState.readmeContent && repo.description && (
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

function StateSyncWarning({
  warning,
  pulling,
}: {
  warning: PoolWarning | null;
  /** Suppress warnings while data is still loading */
  pulling: boolean;
}) {
  // Never show warnings while we're still fetching — the mismatch may resolve
  if (!warning || pulling) return null;

  if (warning.kind === "state-commit-unavailable") {
    const shortState = warning.stateCommitId.slice(0, 8);
    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-0.5">
          <p className="font-medium">Signed commit not found on git server</p>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
            The maintainer signed commit{" "}
            <code className="font-mono">{shortState}</code> as HEAD, but it
            couldn't be found on any git server. Showing the latest available
            commit instead.
          </p>
        </div>
      </div>
    );
  }

  if (warning.kind === "state-behind-git") {
    const shortState = warning.stateCommitId.slice(0, 8);
    const shortGit = warning.gitCommitId.slice(0, 8);
    const stateAge = safeFormatDistanceToNow(warning.stateCreatedAt, {
      addSuffix: true,
    });
    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-0.5">
          <p className="font-medium">Git server is ahead of signed state</p>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
            The maintainer signed{" "}
            <code className="font-mono">{shortState}</code> as HEAD ({stateAge}
            ), but the git server has a newer commit{" "}
            <code className="font-mono">{shortGit}</code>. This usually means a
            push hasn't been signed yet.
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

/**
 * Compute the opacity of the staleness top-bar based on how long ago we last
 * checked the git server. Returns a value between 0 and 1.
 *
 * - Just checked (< 1 min): 0 (invisible)
 * - 1 min – 10 min: 0.08 – 0.2 (barely visible)
 * - 10 min – 1 hour: 0.2 – 0.4
 * - 1 hour – 1 day: 0.4 – 0.7
 * - > 1 day: 0.7
 */
function stalenessOpacity(lastCheckedAt: number | null): number {
  if (lastCheckedAt === null) return 0.35; // never checked — moderate
  const ageS = Math.max(0, Math.floor(Date.now() / 1000) - lastCheckedAt);
  if (ageS < 60) return 0;
  if (ageS < 600) return 0.08 + (ageS - 60) * (0.12 / 540);
  if (ageS < 3600) return 0.2 + (ageS - 600) * (0.2 / 3000);
  if (ageS < 86400) return 0.4 + (ageS - 3600) * (0.3 / 82800);
  return 0.7;
}

function LatestCommitCard({
  poolState,
  repoState,
  pulling,
}: {
  poolState: PoolState;
  repoState: RepositoryState | null | undefined;
  /** True while Nostr EOSE is pending or a git server re-fetch is in flight. */
  pulling: boolean;
}) {
  // Only show the skeleton when we have no commit data at all.
  // When stale cached data is available (pulling=true, loading=true) we skip
  // the skeleton and show the cached commit with the staleness bar instead.
  if (!poolState.latestCommit && poolState.loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-64" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (poolState.error || !poolState.latestCommit) {
    return null;
  }

  const commit = poolState.latestCommit;
  const shortHash = commit.hash.slice(0, 8);
  const subject = commit.message.split("\n")[0];
  const relativeTime = safeFormatDistanceToNow(commit.author.timestamp, {
    addSuffix: true,
  });

  // Determine whether the state event confirms this commit as HEAD
  const stateHeadCommit = repoState?.headCommitId;
  const isConfirmedByState =
    stateHeadCommit !== undefined &&
    (commit.hash.startsWith(stateHeadCommit) ||
      stateHeadCommit.startsWith(commit.hash));
  const defaultBranch = poolState.defaultBranch;

  // Top-edge staleness bar: opacity correlates to how long ago we last checked.
  // While actively pulling, the bar pulses at moderate opacity.
  const barOpacity = pulling ? 0.5 : stalenessOpacity(poolState.lastCheckedAt);
  const showBar = pulling || barOpacity > 0;

  return (
    <Card className="overflow-hidden">
      {/* Thin top-edge bar — opacity fades with staleness, pulses while pulling */}
      <div
        className="h-0.5 w-full transition-opacity duration-700"
        style={
          showBar
            ? {
                backgroundColor: `hsl(var(--primary) / ${barOpacity})`,
                ...(pulling
                  ? { animation: "staleness-pulse 2s ease-in-out infinite" }
                  : {}),
              }
            : { backgroundColor: "transparent" }
        }
      />

      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-muted-foreground" />
          Latest commit
          <div className="ml-auto flex items-center gap-2">
            {/* Branch name */}
            {defaultBranch && (
              <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                {defaultBranch}
              </span>
            )}
          </div>
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
                  &middot; signed by maintainer
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

function ReadmeCard({ poolState }: { poolState: PoolState }) {
  if (poolState.loading) {
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

  if (poolState.error) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Could not load repository data: {poolState.error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!poolState.readmeContent) {
    return null;
  }

  const isMarkdown =
    poolState.readmeFilename?.toLowerCase().endsWith(".md") ||
    poolState.readmeFilename?.toLowerCase().endsWith(".markdown");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          {poolState.readmeFilename ?? "README"}
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
            <MarkdownContent content={poolState.readmeContent} />
          </Suspense>
        ) : (
          <pre className="text-sm whitespace-pre-wrap font-mono text-foreground/80 leading-relaxed">
            {poolState.readmeContent}
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
