/**
 * RepoTagsPage — full-page expansion of the popover ref selector's tags list.
 * Shows every tag in the merged ref view (across all configured git servers
 * + Nostr state) with:
 *
 *   - target commit hash + first-line message + committer timestamp
 *   - annotated/lightweight indicator (annotated = `rawTagOid !== undefined`,
 *     per `parseRefs` in `useGitExplorer.ts`)
 *   - per-ref status vs the Nostr-signed state
 *
 * Tags are sorted newest-version-first via `compareTagsNewestFirst`. There is
 * no ahead/behind computation — that's specific to branches.
 */
import { useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import { useProfile } from "@/hooks/useProfile";
import { useGitPool } from "@/hooks/useGitPool";
import { useGitExplorer } from "@/hooks/useGitExplorer";
import { useRefsWithStatus } from "@/hooks/useRefsWithStatus";
import { SourceSelectorDropdown } from "@/components/SourceSelector";
import { RefRow } from "@/components/RefRow";
import { compareTagsNewestFirst } from "@/lib/refStatus";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag, AlertCircle } from "lucide-react";
import { isNonHttpUrl } from "@/lib/git-grasp-pool";
import { IncompatibleProtocolError } from "@/components/IncompatibleProtocolError";

export default function RepoTagsPage() {
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

  // Mirror RepoCodePage's bootstrap-head-commit logic so the merged ref view
  // is consistent with the /code page even when the Nostr state is ahead.
  const userChoseNostr = selectedSource === "nostr";
  const bootstrapHeadCommit =
    stateBehindGit && !userChoseNostr ? undefined : repoState?.headCommitId;

  const explorer = useGitExplorer(pool, poolState, {
    knownHeadCommit: bootstrapHeadCommit,
  });

  const { tags, mismatchCount, effectiveSource } = useRefsWithStatus({
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

  const sortedTags = useMemo(
    () => [...tags].sort((a, b) => compareTagsNewestFirst(a.name, b.name)),
    [tags],
  );

  useSeoMeta({
    title: repo ? `Tags - ${repo.name} - ngit` : "Tags - ngit",
    description: repo?.description ?? "Browse repository tags",
    ogImage: repoOwnerProfile?.picture ?? "/og-image.svg",
    ogImageAlt: repo?.name,
    twitterCard: repoOwnerProfile?.picture ? "summary" : "summary_large_image",
  });

  // Tag tree links preserve the source query param so the tag opens against
  // the same server the user is viewing.
  const tagHref = useCallback(
    (name: string) => {
      const source = searchParams.get("source");
      const base = `${basePath}/tree/${name}`;
      return source ? `${base}?source=${encodeURIComponent(source)}` : base;
    },
    [searchParams, basePath],
  );

  // -------------------------------------------------------------------------
  // Early returns
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
          context="tags"
          pubkey={pubkey}
          repoId={repoId}
        />
      </div>
    );
  }

  const showSkeletons = explorer.loading && sortedTags.length === 0;
  const showEmpty = !explorer.loading && sortedTags.length === 0;

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6 space-y-4">
      {/* Title row: tag icon + count on the left, source dropdown on the right */}
      <div className="flex items-center gap-3 flex-wrap">
        <Tag className="h-5 w-5 text-muted-foreground shrink-0" />
        <h2 className="text-lg font-semibold shrink-0">Tags</h2>
        {sortedTags.length > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
            {sortedTags.length}
          </Badge>
        )}
        {mismatchCount > 0 && (
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[11px] border-amber-500/40 text-amber-600 dark:text-amber-400"
            title={`${mismatchCount} tag${mismatchCount === 1 ? "" : "s"} differ from Nostr state`}
          >
            {mismatchCount} differ
          </Badge>
        )}
        <div className="ml-auto">
          <SourceSelectorDropdown
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
            winnerUrl={poolState.winnerUrl}
          />
        </div>
      </div>

      {/* List */}
      {showSkeletons && <TagsSkeleton />}

      {showEmpty && (
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <p className="text-muted-foreground max-w-sm mx-auto">
              No tags found on the selected source.
            </p>
          </CardContent>
        </Card>
      )}

      {!showSkeletons && !showEmpty && (
        <Card>
          <div className="divide-y divide-border/40">
            {sortedTags.map((tag) => {
              const row = (
                <RefRow
                  density="expanded"
                  refWithStatus={tag}
                  effectiveSource={effectiveSource}
                  pool={pool}
                  urlStates={poolState.urls}
                  cloneUrls={cloneUrls}
                  annotated={tag.rawTagOid !== undefined}
                />
              );
              return (
                <Link
                  key={tag.name}
                  to={tagHref(tag.name)}
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

function TagsSkeleton() {
  return (
    <Card>
      <div className="divide-y divide-border/40">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="h-4 w-4 mt-0.5 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
