/**
 * PRCommitPage — commit detail view scoped to a pull request.
 *
 * Rendered at: prs/<prId>/commit/<commitId>
 *
 * For PR-type items (kind:1618), the commit exists on a git server and we
 * use CommitDetailView which fetches it via the pool.
 *
 * For patch-type items (kind:1617), the commit only exists as a Nostr event
 * — the git server doesn't have it. We load the patch chain via
 * usePatchChain, find the matching patch by commit ID, build a synthetic
 * Commit from its metadata, and render the patch's embedded diff via
 * PatchCommitDetailView.
 *
 * Supports direct URL navigation: subscribes to relays to fetch the root
 * event when it's not already in the store (e.g. user navigated directly
 * to the commit URL without visiting the PR page first).
 *
 * The "All commits" back link returns to the PR's commits tab
 * (prs/<prId>/commits) rather than the repo-wide commits page.
 */

import { useMemo } from "react";
import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "@/pages/repo/RepoContext";
import { repoToPath } from "@/lib/routeUtils";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Loader2 } from "lucide-react";
import { useGitPool } from "@/hooks/useGitPool";
import { CommitDetailView } from "@/components/CommitDetailView";
import { PatchCommitDetailView } from "@/components/PatchCommitDetailView";
import { PRHeader } from "@/components/PRHeader";
import { PRTabBar } from "@/components/PRTabBar";
import { useEventStore } from "@/hooks/useEventStore";
import { use$ } from "@/hooks/use$";
import { usePatchChain } from "@/hooks/usePatchChain";
import { usePatchMergeBase } from "@/hooks/usePatchMergeBase";
import { useResolvedPR } from "@/hooks/useResolvedPR";
import { useActiveAccount } from "applesauce-react/hooks";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { PATCH_KIND, PR_KIND, extractPatchDiff } from "@/lib/nip34";
import {
  buildSyntheticCommit,
  buildSyntheticCommitFallback,
} from "@/lib/patch-commits";
import type { Filter } from "applesauce-core/helpers";
import type { Patch } from "@/casts/Patch";

export default function PRCommitPage() {
  const {
    cloneUrls,
    prCommitId,
    prBasePath,
    prId,
    resolved,
    pubkey,
    repoId,
    nip05,
  } = useRepoContext();
  const store = useEventStore();
  const repo = resolved?.repo;

  // Resolve the PR for the header — mirrors what PRPage does.
  const selectedMaintainers = useMemo(
    () => (repo?.maintainerSet ? new Set(repo.maintainerSet) : undefined),
    [repo?.maintainerSet],
  );
  const pr = useResolvedPR(
    prId,
    resolved?.repoRelayGroup,
    resolved?.extraRelaysForMaintainerMailboxCoverage,
    selectedMaintainers,
  );
  const activeAccount = useActiveAccount();
  const canEdit = useMemo(() => {
    if (!activeAccount || !pr) return false;
    return pr.authorisedUsers.has(activeAccount.pubkey);
  }, [activeAccount, pr]);

  useSeoMeta({
    title: repo
      ? `${prCommitId?.slice(0, 8) ?? "Commit"} - ${repo.name} - ngit`
      : "Commit - ngit",
    description: `View PR commit details${repo ? ` for ${repo.name}` : ""}`,
  });

  const { pool, poolState } = useGitPool(cloneUrls);

  // Repo base path for linking to repo-level commits (not PR-scoped)
  const repoBasePath = repoToPath(
    pubkey,
    repoId,
    resolved?.repo?.relays ?? [],
    nip05,
  );

  // Subscribe to fetch the root event from relays. This ensures the page
  // works on direct URL navigation (when the event isn't already in the store
  // from the PR list page). We query for both patch and PR kinds.
  use$(() => {
    if (!prId) return undefined;
    const filter: Filter = { kinds: [PATCH_KIND, PR_KIND], ids: [prId] };
    if (resolved?.repoRelayGroup) {
      return resolved.repoRelayGroup
        .subscription([filter])
        .pipe(onlyEvents(), mapEventsToStore(store));
    }
    return undefined;
  }, [prId, resolved?.repoRelayGroup, store]);

  // Reactively determine if the root event is a patch or PR.
  // Uses store.timeline() so it updates when the event arrives from relays.
  const rootEvent = use$(() => {
    if (!prId) return undefined;
    const filter: Filter = { kinds: [PATCH_KIND, PR_KIND], ids: [prId] };
    return store.timeline([filter]);
  }, [prId, store]);

  const rootEventKind = rootEvent?.[0]?.kind;
  const isPatch = rootEventKind === PATCH_KIND;
  const rootEventLoaded = rootEvent !== undefined && rootEvent.length > 0;

  // Load the patch chain when this is a patch-type item.
  // usePatchChain handles relay subscriptions to ensure patches are in the store.
  const patchChain = usePatchChain(
    isPatch ? prId : undefined,
    resolved?.repoRelayGroup,
  );

  // Resolve the merge base so we can show the approximation notice when needed.
  const patchMergeBase = usePatchMergeBase(
    isPatch ? patchChain.chain : undefined,
    pool,
    poolState,
  );

  // Find the patch whose commit tag or event ID matches the requested commit ID.
  const patchMatch = useMemo(() => {
    if (!isPatch || !prCommitId || patchChain.loading) return undefined;

    // Helper: check if a patch matches by commit ID or event ID
    const matchPatch = (patch: Patch, superseded: boolean) => {
      if (patch.commitId === prCommitId || patch.event.id === prCommitId) {
        const commit =
          buildSyntheticCommit(patch) ?? buildSyntheticCommitFallback(patch);
        const diff = extractPatchDiff(patch.content);
        return {
          commit,
          diff,
          patch,
          hasCommitId: !!patch.commitId,
          superseded,
        };
      }
      return undefined;
    };

    // Check the latest chain first (not superseded)
    for (const patch of patchChain.chain) {
      const result = matchPatch(patch, false);
      if (result) return result;
    }

    // Also check all revisions — earlier ones are superseded
    const latestRevisionIdx = patchChain.allRevisions.length - 1;
    for (let i = 0; i < patchChain.allRevisions.length; i++) {
      const revision = patchChain.allRevisions[i];
      const isSuperseded = i < latestRevisionIdx;
      for (const patch of revision.chain) {
        const result = matchPatch(patch, isSuperseded);
        if (result) return result;
      }
    }

    return undefined;
  }, [
    isPatch,
    prCommitId,
    patchChain.chain,
    patchChain.allRevisions,
    patchChain.loading,
  ]);

  // Extract PR clone URLs from the store for git-server fallback.
  const prCloneUrls = useMemo(() => {
    if (!prId) return [];
    const prEvent = store.getByFilters([{ kinds: [PR_KIND], ids: [prId] }])[0];
    if (!prEvent) return [];
    return prEvent.tags
      .filter(([t]) => t === "clone")
      .flatMap(([, ...urls]) => urls.filter(Boolean));
  }, [prId, store]);

  // Determine the content to render inside the page body.
  const content = (() => {
    if (!prCommitId) {
      return (
        <Card className="border-destructive/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>No commit ID specified.</span>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Still loading the root event from relays
    if (!rootEventLoaded) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading…</span>
        </div>
      );
    }

    // Patch-type: loading patch chain
    if (isPatch && patchChain.loading) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading patch data…</span>
        </div>
      );
    }

    // Patch-type: found the matching patch
    if (isPatch && patchMatch) {
      return (
        <PatchCommitDetailView
          commit={patchMatch.commit}
          patchDiff={patchMatch.diff}
          patch={patchMatch.patch}
          pool={pool}
          poolWinnerUrl={poolState.winnerUrl}
          fallbackUrls={[...cloneUrls, ...prCloneUrls]}
          basePath={prBasePath ?? ""}
          repoBasePath={repoBasePath}
          backTo={prBasePath ? `${prBasePath}/commits` : ".."}
          backLabel="PR commits"
          hasCommitId={patchMatch.hasCommitId}
          patchChain={patchChain.chain}
          defaultBranchHead={poolState.latestCommit?.hash}
          superseded={patchMatch.superseded}
          isBaseGuessed={patchMergeBase.isGuessed}
          guessedBaseCommitId={
            patchMergeBase.isGuessed ? patchMergeBase.baseCommitId : undefined
          }
        />
      );
    }

    // Patch-type: patch chain loaded but commit not found
    if (isPatch && !patchChain.loading && !patchMatch) {
      return (
        <Card className="border-destructive/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                Commit {prCommitId.slice(0, 8)} not found in this patch set.
              </span>
            </div>
          </CardContent>
        </Card>
      );
    }

    // PR-type: use git server
    if (!pool) return null;

    return (
      <CommitDetailView
        commitId={prCommitId}
        pool={pool}
        basePath={prBasePath ?? ""}
        backTo={prBasePath ? `${prBasePath}/commits` : ".."}
        backLabel="PR commits"
        fallbackUrls={prCloneUrls}
      />
    );
  })();

  const tabBar = prBasePath ? (
    <PRTabBar
      prBasePath={prBasePath}
      pr={pr}
      patchChain={isPatch ? patchChain.chain : undefined}
    />
  ) : undefined;

  return (
    <>
      <PRHeader pr={pr} canEdit={canEdit} tabs={tabBar} />
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        {content}
      </div>
    </>
  );
}
