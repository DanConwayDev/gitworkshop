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
 * The "All commits" back link returns to the PR's commits tab
 * (prs/<prId>/commits) rather than the repo-wide commits page.
 */

import { useMemo } from "react";
import { useRepoContext } from "@/pages/repo/RepoContext";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Loader2 } from "lucide-react";
import { useGitPool } from "@/hooks/useGitPool";
import { CommitDetailView } from "@/components/CommitDetailView";
import { PatchCommitDetailView } from "@/components/PatchCommitDetailView";
import { useEventStore } from "@/hooks/useEventStore";
import { usePatchChain } from "@/hooks/usePatchChain";
import { PATCH_KIND, PR_KIND, extractPatchDiff } from "@/lib/nip34";
import {
  buildSyntheticCommit,
  buildSyntheticCommitFallback,
} from "@/lib/patch-commits";
import type { NostrEvent } from "nostr-tools";
import type { Patch } from "@/casts/Patch";

export default function PRCommitPage() {
  const { cloneUrls, prCommitId, prBasePath, prId, resolved } =
    useRepoContext();
  const store = useEventStore();

  const { pool } = useGitPool(cloneUrls);

  // Determine if the root event is a patch (kind:1617) or PR (kind:1618).
  // The root event should already be in the store from the PR list page.
  const rootEventKind = useMemo(() => {
    if (!prId) return undefined;
    // Check for patch first, then PR
    const patchEvents = store.getByFilters([
      { kinds: [PATCH_KIND], ids: [prId] },
    ]) as NostrEvent[];
    if (patchEvents.length > 0) return PATCH_KIND;
    const prEvents = store.getByFilters([
      { kinds: [PR_KIND], ids: [prId] },
    ]) as NostrEvent[];
    if (prEvents.length > 0) return PR_KIND;
    return undefined;
  }, [prId, store]);

  const isPatch = rootEventKind === PATCH_KIND;

  // Load the patch chain when this is a patch-type item.
  // usePatchChain handles relay subscriptions to ensure patches are in the store.
  const patchChain = usePatchChain(
    isPatch ? prId : undefined,
    resolved?.repoRelayGroup,
  );

  // Find the patch whose commit tag or event ID matches the requested commit ID.
  const patchMatch = useMemo(() => {
    if (!isPatch || !prCommitId || patchChain.loading) return undefined;

    // Helper: check if a patch matches by commit ID or event ID
    const matchPatch = (patch: Patch) => {
      if (patch.commitId === prCommitId || patch.event.id === prCommitId) {
        const commit =
          buildSyntheticCommit(patch) ?? buildSyntheticCommitFallback(patch);
        const diff = extractPatchDiff(patch.content);
        return { commit, diff, hasCommitId: !!patch.commitId };
      }
      return undefined;
    };

    for (const patch of patchChain.chain) {
      const result = matchPatch(patch);
      if (result) return result;
    }

    // Also check all revisions (not just the latest chain)
    for (const revision of patchChain.allRevisions) {
      for (const patch of revision.chain) {
        const result = matchPatch(patch);
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

  if (!prCommitId) {
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

  // Patch-type: loading patch chain
  if (isPatch && patchChain.loading) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading patch data…</span>
        </div>
      </div>
    );
  }

  // Patch-type: found the matching patch
  if (isPatch && patchMatch) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <PatchCommitDetailView
          commit={patchMatch.commit}
          patchDiff={patchMatch.diff}
          basePath={prBasePath ?? ""}
          backTo={prBasePath ? `${prBasePath}/commits` : ".."}
          hasCommitId={patchMatch.hasCommitId}
        />
      </div>
    );
  }

  // Patch-type: patch chain loaded but commit not found
  if (isPatch && !patchChain.loading && !patchMatch) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
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
      </div>
    );
  }

  // PR-type: use git server
  if (!pool) return null;

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      <CommitDetailView
        commitId={prCommitId}
        pool={pool}
        basePath={prBasePath ?? ""}
        backTo={prBasePath ? `${prBasePath}/commits` : ".."}
        fallbackUrls={prCloneUrls}
      />
    </div>
  );
}
