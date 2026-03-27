import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
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

export default function RepoCommitsPage() {
  const { cloneUrls, repoState, repoRelayEose, commitsRef, resolved } =
    useRepoContext();
  const navigate = useNavigate();
  const repo = resolved?.repo;

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

  // When the git server is confirmed ahead of the signed Nostr state, don't
  // pass a knownHeadCommit so the explorer falls through to the default branch
  // (matching the Code tab behaviour).
  const effectiveHeadCommit = stateBehindGit
    ? undefined
    : repoState?.headCommitId;

  // Always fetch refs so we can populate the selector.
  // Pass commitsRef so the explorer resolves to the right commit hash.
  const explorer = useGitExplorer(pool, poolState, {
    refAndPath: commitsRef,
    knownHeadCommit: effectiveHeadCommit,
  });

  const resolvedRef = explorer.resolvedRef ?? undefined;

  // When the git server is confirmed ahead of the signed state, use the pool's
  // authoritative gitCommitId directly — this is available as soon as the pool
  // computes the warning, before the explorer has had a chance to re-run.
  // Otherwise fall back to the explorer's resolved commit hash (full 40-char),
  // which avoids re-resolving the branch name against infoRefs (which could
  // map to an older commit on a different server).
  const historyCommit: string | undefined = stateBehindGit
    ? poolState.warning?.kind === "state-behind-git"
      ? poolState.warning.gitCommitId
      : (explorer.commitHash ?? undefined)
    : (explorer.commitHash ?? undefined);

  const history = useInfiniteCommitHistory(pool, poolState, historyCommit);

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
        {explorer.refs.length > 0 ? (
          <RefSelector
            refs={explorer.refs}
            currentRef={resolvedRef ?? ""}
            onRefChange={handleRefChange}
            repoState={repoState}
            repoRelayEose={repoRelayEose}
            loading={explorer.loading}
            stateBehindGit={stateBehindGit}
            poolWarning={poolState.warning}
            winnerUrl={poolState.winnerUrl}
          />
        ) : explorer.loading ? (
          <Skeleton className="h-8 w-28" />
        ) : resolvedRef ? (
          <code className="font-mono text-violet-600 dark:text-violet-400 text-sm">
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
              const ref = explorer.refs.find((r) => r.name === resolvedRef);
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
