import { useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import {
  useInfiniteCommitHistory,
  useGitExplorer,
} from "@/hooks/useGitExplorer";
import { useGitPool } from "@/hooks/useGitPool";
import { RefSelector } from "@/components/RefSelector";
import { GitServerStatus } from "@/components/GitServerStatus";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  CommitList,
  CommitListLoading,
  CommitListEmpty,
  CommitListError,
} from "@/components/CommitList";
import { AlertCircle, GitCommit, Loader2 } from "lucide-react";
import { safeFormatDistanceToNow } from "@/lib/utils";
import {
  deriveEffectiveHeadCommit,
  deriveEffectiveSource,
} from "@/lib/sourceUtils";

export default function RepoCommitsPage() {
  const { cloneUrls, repoState, repoRelayEose, commitsRef, resolved } =
    useRepoContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const repo = resolved?.repo;

  // "source" query param drives which server's commit history is shown.
  const selectedSource = searchParams.get("source") ?? "default";

  const handleSourceChange = useCallback(
    (src: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (src === "default") {
            next.delete("source");
          } else {
            next.set("source", src);
          }
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  // Pool must come before explorer since pool is passed to explorer.
  const { pool, poolState } = useGitPool(cloneUrls, {
    knownHeadCommit: repoState?.headCommitId,
    stateRefs: repoState?.refs,
    stateCreatedAt: repoState ? repoState.event.created_at : undefined,
  });

  const pulling =
    cloneUrls.length > 0 ? !repoRelayEose || poolState.pulling : false;
  const gitPulling = cloneUrls.length > 0 ? poolState.pulling : false;
  const stateBehindGit =
    !gitPulling && poolState.warning?.kind === "state-behind-git";

  // Bootstrap explorer: resolves refs and the current ref name.
  const bootstrapHeadCommit = stateBehindGit
    ? undefined
    : repoState?.headCommitId;
  const explorer = useGitExplorer(pool, poolState, {
    refAndPath: commitsRef,
    knownHeadCommit: bootstrapHeadCommit,
  });

  const resolvedRef = explorer.resolvedRef ?? undefined;
  const resolvedRefIsBranch =
    explorer.refs.find((r) => r.name === resolvedRef)?.isBranch ?? true;

  // Resolve "default" → "nostr" or a concrete git server URL.
  const isNoState = repoRelayEose && repoState === null;
  const effectiveSource = useMemo(
    () =>
      deriveEffectiveSource(
        selectedSource,
        stateBehindGit,
        isNoState,
        poolState.winnerUrl,
      ),
    [selectedSource, stateBehindGit, isNoState, poolState.winnerUrl],
  );

  // Derive the effective HEAD commit from the effective source.
  const effectiveHeadCommit = useMemo(() => {
    return deriveEffectiveHeadCommit(
      effectiveSource,
      poolState.urls,
      repoState ?? null,
      stateBehindGit,
      resolvedRef ?? null,
      resolvedRefIsBranch,
    );
  }, [
    effectiveSource,
    poolState.urls,
    repoState,
    stateBehindGit,
    resolvedRef,
    resolvedRefIsBranch,
  ]);

  // When the effective commit differs from the bootstrap, run a second explorer
  // to fetch the source-specific tree (needed to get the right commitHash for
  // the history hook below).
  const explorerForSource = useGitExplorer(pool, poolState, {
    refAndPath: commitsRef,
    knownHeadCommit: effectiveHeadCommit,
  });

  const useSourceExplorer =
    effectiveSource !== "nostr" && effectiveHeadCommit !== bootstrapHeadCommit;
  const activeExplorer = useSourceExplorer ? explorerForSource : explorer;

  // Derive the commit hash to use for history.
  // When the effective source is a git server, use that server's commit directly.
  // When nostr and git is ahead, use the pool's authoritative commit.
  const historyCommit: string | undefined = useMemo(() => {
    if (effectiveSource !== "nostr" && effectiveHeadCommit) {
      return effectiveHeadCommit;
    }
    if (stateBehindGit) {
      return poolState.warning?.kind === "state-behind-git"
        ? poolState.warning.gitCommitId
        : (activeExplorer.commitHash ?? undefined);
    }
    return activeExplorer.commitHash ?? undefined;
  }, [
    effectiveSource,
    effectiveHeadCommit,
    stateBehindGit,
    poolState.warning,
    activeExplorer.commitHash,
  ]);

  const history = useInfiniteCommitHistory(pool, poolState, historyCommit);

  useSeoMeta({
    title: repo
      ? resolvedRef
        ? `Commits on ${resolvedRef} - ${repo.name} - ngit`
        : `Commits - ${repo.name} - ngit`
      : "Commits - ngit",
    description: repo?.description ?? "Browse commit history",
  });

  // Build base path for commit links (strip /commits/... suffix)
  const basePath = useMemo(() => {
    const pathname = window.location.pathname;
    const idx = pathname.indexOf("/commits");
    return idx !== -1 ? pathname.slice(0, idx) : pathname;
  }, []);

  const handleRefChange = (newRef: string) => {
    navigate(`${basePath}/commits/${newRef}`);
  };

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
      {/* Header: "Commits on" + ref selector + checked status + server status */}
      <div className="flex items-center gap-3 flex-wrap">
        <GitCommit className="h-5 w-5 text-muted-foreground shrink-0" />
        <h2 className="text-lg font-semibold shrink-0">Commits on</h2>
        {activeExplorer.refs.length > 0 ? (
          <RefSelector
            refs={activeExplorer.refs}
            currentRef={resolvedRef ?? ""}
            onRefChange={handleRefChange}
            selectedSource={selectedSource}
            onSourceChange={handleSourceChange}
            repoState={repoState}
            repoRelayEose={repoRelayEose}
            loading={activeExplorer.loading}
            stateBehindGit={stateBehindGit}
            poolWarning={poolState.warning}
            winnerUrl={poolState.winnerUrl}
            stateCreatedAt={repoState?.event.created_at}
            urlStates={poolState.urls}
            cloneUrls={cloneUrls}
            pool={pool}
          />
        ) : activeExplorer.loading ? (
          <Skeleton className="h-8 w-28" />
        ) : resolvedRef ? (
          <code className="font-mono text-pink-600 dark:text-pink-400 text-sm">
            {resolvedRef}
          </code>
        ) : null}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Checked status */}
        {pulling ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking…
          </span>
        ) : repoState ? (
          <span className="text-xs text-muted-foreground/60 shrink-0 whitespace-nowrap">
            checked just now
          </span>
        ) : poolState.lastCheckedAt ? (
          <span className="text-xs text-muted-foreground/60 shrink-0 whitespace-nowrap">
            checked{" "}
            {safeFormatDistanceToNow(poolState.lastCheckedAt, {
              addSuffix: true,
            })}
          </span>
        ) : null}

        {/* Git server status */}
        {cloneUrls.length > 0 && (
          <GitServerStatus
            currentRefFull={(() => {
              const ref = activeExplorer.refs.find(
                (r) => r.name === resolvedRef,
              );
              if (!ref || !resolvedRef) return "";
              return ref.isBranch
                ? `refs/heads/${resolvedRef}`
                : `refs/tags/${resolvedRef}`;
            })()}
            currentRefShort={resolvedRef ?? ""}
            repoRelayEose={repoRelayEose}
            hasStateEvent={!!repoState}
            urlStates={poolState.urls}
            cloneUrls={cloneUrls}
            graspCloneUrls={repo?.graspCloneUrls ?? []}
            additionalGitServerUrls={repo?.additionalGitServerUrls ?? []}
            crossRefDiscrepancies={poolState.crossRefDiscrepancies}
            pool={pool}
            stateCreatedAt={repoState?.event.created_at}
          />
        )}
      </div>

      {history.error && <CommitListError message={history.error} />}

      {history.loading && <CommitListLoading count={8} />}

      {!history.loading && history.commits.length > 0 && (
        <CommitList
          commits={history.commits}
          basePath={basePath}
          hasMore={history.hasMore}
          loadingMore={history.loadingMore}
          onLoadMore={history.loadMore}
        />
      )}

      {!history.loading && !history.error && history.commits.length === 0 && (
        <CommitListEmpty />
      )}
    </div>
  );
}
