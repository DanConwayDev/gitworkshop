/**
 * RepoBranchesPage — full-page expansion of the popover ref selector's
 * branches list. Shows every branch in the merged ref view (across all
 * configured git servers + Nostr state) with:
 *
 *   - default-branch badge
 *   - per-ref status vs the Nostr-signed state (verified / mismatch / etc.)
 *   - latest commit hash, message and committer timestamp
 *   - ahead/behind counts vs the default branch
 *
 * The source selector behaves identically to the popover surface: switching
 * source recomputes per-ref status against that server, preserves other query
 * params, and is rendered through `<SourceSelector presentation="page-toolbar" />`.
 */
import { useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import { useProfile } from "@/hooks/useProfile";
import { useGitPool } from "@/hooks/useGitPool";
import { useGitExplorer } from "@/hooks/useGitExplorer";
import { useRefsWithStatus } from "@/hooks/useRefsWithStatus";
import { useBranchDivergence } from "@/hooks/useBranchDivergence";
import { SourceSelector } from "@/components/SourceSelector";
import { RefRow } from "@/components/RefRow";
import type { RefWithStatus } from "@/lib/refStatus";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GitBranch, AlertCircle } from "lucide-react";
import { isNonHttpUrl } from "@/lib/git-grasp-pool";
import { IncompatibleProtocolError } from "@/components/IncompatibleProtocolError";

// ---------------------------------------------------------------------------
// Branch ranking — drives the on-page sort order
// ---------------------------------------------------------------------------

type DivergenceMap = ReturnType<typeof useBranchDivergence>["divergence"];

/**
 * Lower rank = sorted earlier (closer to the top of the list, after the
 * default branch).
 *
 * Buckets:
 *   0 — merged (no commits ahead, some commits behind)
 *   1 — up-to-date (ahead === 0 && behind === 0)
 *   2 — ahead-only (commits ahead, none behind)
 *   3 — diverged (both ahead and behind)
 *   4 — unknown (divergence not yet computed)
 */
function branchRank(
  divergence: { ahead: number | null; behind: number | null } | undefined,
): number {
  if (!divergence) return 4;
  const { ahead, behind } = divergence;
  if (ahead === null || behind === null) return 4;
  if (ahead === 0 && behind > 0) return 0;
  if (ahead === 0 && behind === 0) return 1;
  if (ahead > 0 && behind === 0) return 2;
  return 3; // diverged
}

function sortBranches(
  branches: RefWithStatus[],
  divergence: DivergenceMap,
): RefWithStatus[] {
  return [...branches].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    const da = divergence.get(`refs/heads/${a.name}`);
    const db = divergence.get(`refs/heads/${b.name}`);
    const ra = branchRank(da);
    const rb = branchRank(db);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RepoBranchesPage() {
  const {
    cloneUrls,
    repoState,
    repoRelayEose,
    relayStateMap,
    resolved,
    pubkey,
    repoId,
    basePath,
  } = useRepoContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const repo = resolved?.repo;
  const repoOwnerProfile = useProfile(pubkey);

  // "source" query param drives which server's branches/status are shown.
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

  const { pool, poolState } = useGitPool(cloneUrls, {
    knownHeadCommit: repoState?.headCommitId,
    stateRefs: repoState?.refs,
    stateCreatedAt: repoState ? repoState.event.created_at : undefined,
  });

  const stateBehindGit =
    cloneUrls.length > 0 &&
    !poolState.pulling &&
    poolState.warning?.kind === "state-behind-git";

  // Use the same bootstrap-head-commit derivation as RepoCodePage so the
  // explorer reports the merged ref view from `getMergedInfoRefs()` even
  // when the Nostr state is ahead of the chosen server.
  const userChoseNostr = selectedSource === "nostr";
  const bootstrapHeadCommit =
    stateBehindGit && !userChoseNostr ? undefined : repoState?.headCommitId;

  const explorer = useGitExplorer(pool, poolState, {
    knownHeadCommit: bootstrapHeadCommit,
  });

  const { branches, mismatchCount, effectiveSource } = useRefsWithStatus({
    refs: explorer.refs,
    selectedSource,
    repoState,
    repoRelayEose,
    relayStateMap,
    stateBehindGit,
    poolWarning: poolState.warning,
    winnerUrl: poolState.winnerUrl,
    urlStates: poolState.urls,
    cloneUrls,
  });

  const defaultBranch = useMemo(
    () => branches.find((b) => b.isDefault && b.isBranch),
    [branches],
  );

  const { divergence, loading: divergenceLoading } = useBranchDivergence(
    pool,
    branches,
    defaultBranch,
  );

  const sortedBranches = useMemo(
    () => sortBranches(branches, divergence),
    [branches, divergence],
  );

  useSeoMeta({
    title: repo ? `Branches - ${repo.name} - ngit` : "Branches - ngit",
    description: repo?.description ?? "Browse repository branches",
    ogImage: repoOwnerProfile?.picture ?? "/og-image.svg",
    ogImageAlt: repo?.name,
    twitterCard: repoOwnerProfile?.picture ? "summary" : "summary_large_image",
  });

  // Build the per-branch tree URL while preserving the source query param so
  // navigating into a branch keeps the user on the same server.
  const branchHref = useCallback(
    (name: string) => {
      const source = searchParams.get("source");
      const base = `${basePath}/tree/${name}`;
      return source ? `${base}?source=${encodeURIComponent(source)}` : base;
    },
    [searchParams, basePath],
  );

  // -------------------------------------------------------------------------
  // Early returns: no clone URLs, incompatible protocols
  // -------------------------------------------------------------------------
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

  if (cloneUrls.every(isNonHttpUrl)) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <IncompatibleProtocolError
          cloneUrls={cloneUrls}
          context="branches"
          pubkey={pubkey}
          repoId={repoId}
        />
      </div>
    );
  }

  const showSkeletons = explorer.loading && sortedBranches.length === 0;
  const showEmpty = !explorer.loading && sortedBranches.length === 0;
  const branchCount = sortedBranches.length;
  const defaultBranchName = defaultBranch?.name;

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6 space-y-4">
      {/* Title + count */}
      <div className="flex items-center gap-3 flex-wrap">
        <GitBranch className="h-5 w-5 text-muted-foreground shrink-0" />
        <h2 className="text-lg font-semibold shrink-0">Branches</h2>
        {branchCount > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
            {branchCount}
          </Badge>
        )}
        {mismatchCount > 0 && (
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[11px] border-amber-500/40 text-amber-600 dark:text-amber-400"
            title={`${mismatchCount} branch${mismatchCount === 1 ? "" : "es"} differ from Nostr state`}
          >
            {mismatchCount} differ
          </Badge>
        )}
      </div>

      {/* Source selector — full-page toolbar card */}
      <SourceSelector
        presentation="page-toolbar"
        selectedSource={selectedSource}
        onSelectSource={handleSourceChange}
        repoState={repoState}
        repoRelayEose={repoRelayEose}
        stateCreatedAt={repoState?.event.created_at}
        urlStates={poolState.urls}
        cloneUrls={cloneUrls}
        graspCloneUrls={repo?.graspCloneUrls ?? []}
        additionalGitServerUrls={repo?.additionalGitServerUrls ?? []}
        stateBehindGit={stateBehindGit}
        poolWarning={poolState.warning}
        pool={pool}
        relayStateMap={relayStateMap}
      />

      {/* List body */}
      {showSkeletons && <BranchesSkeleton />}

      {showEmpty && (
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <p className="text-muted-foreground max-w-sm mx-auto">
              No branches found on the selected source.
            </p>
          </CardContent>
        </Card>
      )}

      {!showSkeletons && !showEmpty && (
        <Card>
          {defaultBranchName && (
            <div className="px-4 py-2 border-b border-border/40 text-xs text-muted-foreground">
              Compared with{" "}
              <code className="font-mono text-foreground/80">
                {defaultBranchName}
              </code>
              {divergenceLoading && (
                <span className="ml-2 text-muted-foreground/60">
                  · computing divergence…
                </span>
              )}
            </div>
          )}
          <div className="divide-y divide-border/40">
            {sortedBranches.map((branch) => {
              const fullName = `refs/heads/${branch.name}`;
              const div = branch.isDefault
                ? undefined
                : divergence.get(fullName);
              const row = (
                <RefRow
                  density="expanded"
                  refWithStatus={branch}
                  effectiveSource={effectiveSource}
                  pool={pool}
                  urlStates={poolState.urls}
                  divergence={div}
                />
              );
              // Wrap each row in a Link so the whole row navigates to the
              // branch's tree. We pass no `onSelect` to RefRow so it renders
              // as a non-interactive div inside the Link.
              return (
                <Link
                  key={branch.name}
                  to={branchHref(branch.name)}
                  className="block hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
                >
                  {row}
                </Link>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function BranchesSkeleton() {
  return (
    <Card>
      <div className="divide-y divide-border/40">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="h-4 w-4 mt-0.5 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-72" />
            </div>
            <Skeleton className="h-5 w-12 rounded" />
          </div>
        ))}
      </div>
    </Card>
  );
}
