import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { repoToPath } from "@/lib/routeUtils";
import { useSeoMeta } from "@unhead/react";
import { useActiveAccount } from "applesauce-react/hooks";
import { formatDistanceToNow } from "date-fns";
import { EditableSubject } from "@/components/EditSubjectInline";
import {
  EventBodyCard,
  EventBodyCardSkeleton,
  CommentSkeleton,
  CoverNoteCard,
  SubjectRenameCard,
  StatusChangeCard,
  LabelChangeCard,
} from "@/components/EventThreadComponents";
import { ThreadTree } from "@/components/ThreadTree";

import { useResolvedPR } from "@/hooks/useResolvedPR";
import { EventSearchStatus } from "@/components/EventSearchStatus";
import type { RelayGroupSpec } from "@/hooks/useEventSearch";
import { useRepoContext } from "@/pages/repo/RepoContext";
import { gitIndexRelays, extraRelays } from "@/services/settings";
import { useGitPool } from "@/hooks/useGitPool";
import { UserAvatar, UserLink } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { LabelBadge } from "@/components/LabelBadge";
import { ChangeStatusDropdown } from "@/components/ChangeStatusDropdown";
import { ReplyBox } from "@/components/ReplyBox";
import { CoverNoteBox } from "@/components/CoverNoteBox";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  AlertCircle,
  ArrowLeft,
  MessageCircle,
  Zap,
  Users,
  Clock,
  GitPullRequest,
  GitCommitHorizontal,
  FileDiff,
  Loader2,
  Pin,
} from "lucide-react";
import {
  PatchSetPushEvent,
  PRUpdatePushEvent,
} from "@/components/PushEventComponents";
import { cn } from "@/lib/utils";
import { PRFilesTab } from "@/components/PRFilesTab";
import { PatchFilesTab } from "@/components/PatchFilesTab";
import { diffTrees } from "@/lib/git-grasp-pool";
import { computePatchFileChanges } from "@/lib/patch-diff-merge";
import {
  CommitList,
  CommitListLoading,
  CommitListEmpty,
  CommitListError,
} from "@/components/CommitList";
import { PatchCommitList } from "@/components/PatchCommitList";
import { useCommitHistory } from "@/hooks/useGitExplorer";
import { usePRMergeBase } from "@/hooks/usePRMergeBase";
import { usePatchMergeBase } from "@/hooks/usePatchMergeBase";
import { MergePanel } from "@/components/MergePanel";
import { CommitDetailView } from "@/components/CommitDetailView";
import { PatchCommitDetailView } from "@/components/PatchCommitDetailView";
import { useEventStore } from "@/hooks/useEventStore";
import { use$ } from "@/hooks/use$";
import { usePatchChain } from "@/hooks/usePatchChain";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { withGapFill } from "@/lib/withGapFill";
import { pool } from "@/services/nostr";
import { PATCH_KIND, PR_KIND, extractPatchDiff } from "@/lib/nip34";
import { eventIdToNevent } from "@/lib/routeUtils";
import {
  buildSyntheticCommit,
  buildSyntheticCommitFallback,
} from "@/lib/patch-commits";
import type { Filter } from "applesauce-core/helpers";
import type { Patch } from "@/casts/Patch";

export default function PRPage() {
  const {
    pubkey,
    repoId,
    resolved,
    prId,
    cloneUrls,
    prBasePath,
    repoState,
    nip05,
    prCommitId,
  } = useRepoContext();
  const location = useLocation();
  const navigate = useNavigate();
  const repo = resolved?.repo;
  const store = useEventStore();

  // Compute the effective maintainer set.
  const selectedMaintainers = useMemo(
    () => (repo?.maintainerSet ? new Set(repo.maintainerSet) : undefined),
    [repo?.maintainerSet],
  );

  // ── "Search more relays" expansion (curated mode) ────────────────────────
  const [searchMoreActive, setSearchMoreActive] = useState(false);

  const extraSearchGroups = useMemo<RelayGroupSpec[]>(() => {
    if (!searchMoreActive) return [];
    return [
      { label: "git index", relays$: gitIndexRelays },
      { label: "extra relays", relays$: extraRelays },
    ];
  }, [searchMoreActive]);

  const handleSearchMore = useCallback(() => {
    setSearchMoreActive(true);
  }, []);

  // ── Unified PR/Patch resolution ─────────────────────────────────────────
  const { pr, search } = useResolvedPR(
    prId,
    resolved?.repoRelayGroup,
    resolved?.extraRelaysForMaintainerMailboxCoverage,
    selectedMaintainers,
    undefined, // options
    extraSearchGroups,
  );

  // Ordered priority pubkeys for @ mention autocomplete:
  // parent author first, then participants, then maintainers (deduped).
  const mentionPriorityPubkeys = useMemo<string[]>(() => {
    if (!pr) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (pk: string) => {
      if (!seen.has(pk)) {
        seen.add(pk);
        out.push(pk);
      }
    };
    add(pr.pubkey);
    for (const pk of pr.participants) add(pk);
    for (const pk of repo?.maintainerSet ?? []) add(pk);
    return out;
  }, [pr, repo?.maintainerSet]);

  // Git pool — uses the repo's clone URLs (same as RepoCodePage).
  const { pool: gitPool, poolState: gitPoolState } = useGitPool(cloneUrls);

  // Derive the active tab from the URL.
  // Also returns "commits" when on a commit detail sub-path.
  const activeTab = useMemo(() => {
    const p = location.pathname;
    if (p.endsWith("/commits") || p.includes("/commit/")) return "commits";
    if (p.endsWith("/files")) return "files";
    return "conversation";
  }, [location.pathname]);

  const handleTabChange = (value: string) => {
    if (!prBasePath) return;
    if (value === "conversation") {
      navigate(prBasePath);
    } else {
      navigate(`${prBasePath}/${value}`);
    }
  };

  // ── Git data (lazy — depends on tip from the model) ─────────────────────
  // Clone URLs: merge repo clone URLs with PR/patch-specific ones
  const effectiveCloneUrls = useMemo(() => {
    const urls = [...(pr?.tip.cloneUrls ?? []), ...cloneUrls];
    return Array.from(new Set(urls));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr?.tip.cloneUrls?.join(","), cloneUrls.join(",")]);

  // Merge-base: use explicit tag when available, otherwise derive via git
  const { mergeBase: effectiveMergeBase, computing: computingMergeBase } =
    usePRMergeBase(
      gitPool,
      gitPoolState,
      pr?.tip.commitId,
      pr?.tip.explicitMergeBase,
      effectiveCloneUrls,
    );

  // Commit history for the PR commits tab — fetches from the effective tip.
  const prCommitHistory = useCommitHistory(
    gitPool,
    gitPoolState,
    pr?.itemType === "pr" ? pr?.tip.commitId : undefined,
    100,
    effectiveCloneUrls,
  );
  const prCommits = useMemo(() => {
    const trimmed = (() => {
      if (!effectiveMergeBase || !prCommitHistory.commits.length)
        return prCommitHistory.commits;
      const idx = prCommitHistory.commits.findIndex(
        (c) => c.hash === effectiveMergeBase,
      );
      return idx === -1
        ? prCommitHistory.commits
        : prCommitHistory.commits.slice(0, idx);
    })();
    // Reverse to oldest-first (git walks newest-first from tip).
    // Matches GitHub's PR commits tab convention and the patch body card order.
    return [...trimmed].reverse();
  }, [prCommitHistory.commits, effectiveMergeBase]);

  // ── Ahead / behind counts ─────────────────────────────────────────────
  const aheadCount =
    pr?.itemType === "pr"
      ? prCommits.length > 0
        ? prCommits.length
        : undefined
      : pr?.revisions.length
        ? pr.revisions[pr.revisions.length - 1].patches?.filter(
            (p) => !p.isCoverLetter,
          ).length
        : undefined;

  const defaultBranchName = gitPoolState.defaultBranch ?? repoState?.headBranch;

  const defaultBranchHead = gitPoolState.latestCommit?.hash;
  const [behindCount, setBehindCount] = useState<number | undefined>(undefined);
  const behindAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!gitPool || !effectiveMergeBase) {
      setBehindCount(undefined);
      return;
    }

    behindAbortRef.current?.abort();
    const abort = new AbortController();
    behindAbortRef.current = abort;

    gitPool
      .countCommitsBehind(effectiveMergeBase, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        setBehindCount(result ?? undefined);
      })
      .catch(() => {
        if (!abort.signal.aborted) setBehindCount(undefined);
      });

    return () => abort.abort();
  }, [gitPool, effectiveMergeBase, defaultBranchHead]);

  // Patch chain — needed for both file count and Commits tab.
  // Cover-letter patches (t:cover-letter) are excluded — they carry no diff
  // and should not appear in commit lists or counts.
  const patchChain =
    pr?.itemType === "patch" && pr.revisions.length > 0
      ? pr.revisions[pr.revisions.length - 1].patches?.filter(
          (p) => !p.isCoverLetter,
        )
      : undefined;

  // ── Patch merge base ──────────────────────────────────────────────────
  // Resolves the base commit for the patch chain: uses the parent-commit tag
  // when present, otherwise approximates via the timestamp heuristic.
  const patchMergeBase = usePatchMergeBase(patchChain, gitPool, gitPoolState);

  // ── File count (eager for tab badge) ──────────────────────────────────
  const [fileCount, setFileCount] = useState<number | undefined>(undefined);
  const fileCountAbortRef = useRef<AbortController | null>(null);

  // ── Patch apply result (from PatchFilesTab, shared with commits tab) ──
  const [patchApplyResult, setPatchApplyResult] = useState<
    | {
        failedCount: number;
        failureReason?: "no-base" | "fetch-failed" | "hunk-mismatch";
      }
    | undefined
  >(undefined);

  // For patches: compute file count synchronously from the patch chain
  const patchFileCount = useMemo(() => {
    if (pr?.itemType !== "patch" || !patchChain || patchChain.length === 0)
      return undefined;
    return computePatchFileChanges(patchChain).length;
  }, [pr?.itemType, patchChain]);

  useEffect(() => {
    if (pr?.itemType === "patch") return; // patches use patchFileCount instead
    if (!gitPool || !pr?.tip.commitId || !effectiveMergeBase) return;

    fileCountAbortRef.current?.abort();
    const abort = new AbortController();
    fileCountAbortRef.current = abort;

    gitPool
      .getCommitRange(
        pr.tip.commitId,
        effectiveMergeBase,
        abort.signal,
        effectiveCloneUrls,
      )
      .then((range) => {
        if (abort.signal.aborted || !range) return;
        setFileCount(diffTrees(range.tipTree, range.baseTree).length);
      })
      .catch(() => {
        /* ignore errors — count just won't show */
      });

    return () => {
      abort.abort();
    };
  }, [
    pr?.itemType,
    gitPool,
    pr?.tip.commitId,
    effectiveMergeBase,
    effectiveCloneUrls,
  ]);

  // Effective file count: use patch-derived count for patches, git-derived for PRs
  const effectiveFileCount =
    pr?.itemType === "patch" ? patchFileCount : fileCount;

  // ── Auth ──────────────────────────────────────────────────────────────
  const activeAccount = useActiveAccount();
  const canEdit = useMemo(() => {
    if (!activeAccount || !pr) return false;
    return pr.authorisedUsers.has(activeAccount.pubkey);
  }, [activeAccount, pr]);

  // Maintainer check: only maintainers (not just PR author) can merge
  const isMaintainer = useMemo(() => {
    if (!activeAccount || !pr) return false;
    return pr.maintainers.has(activeAccount.pubkey);
  }, [activeAccount, pr]);

  // ── Cover note editor state ───────────────────────────────────────────────
  const [coverNoteEditing, setCoverNoteEditing] = useState(false);
  const handleCoverNoteSubmitted = useCallback(
    () => setCoverNoteEditing(false),
    [],
  );
  const handleCoverNoteCancel = useCallback(
    () => setCoverNoteEditing(false),
    [],
  );

  // ── SEO ───────────────────────────────────────────────────────────────
  useSeoMeta({
    title: pr
      ? `${pr.currentSubject || pr.originalSubject} - ngit`
      : "PR - ngit",
    description: pr?.body.slice(0, 160) || "Loading PR...",
  });

  // ── Derived values ────────────────────────────────────────────────────
  const TypeIcon =
    pr?.itemType === "patch" ? GitCommitHorizontal : GitPullRequest;

  // ── Repo base path (for PR-commit back links) ─────────────────────────
  const repoBasePath = repoToPath(
    pubkey,
    repoId,
    resolved?.repo?.relays ?? [],
    nip05,
  );

  // Relay hints for nevent1 encoding of patch commit URL segments.
  const repoRelayHints = useMemo(
    () => resolved?.repoRelayGroup?.relays.map((r) => r.url) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved?.repoRelayGroup?.relays.map((r) => r.url).join(",")],
  );

  // ── Commit detail logic (inlined from PRCommitPage) ───────────────────
  // Subscribe to fetch the root event from relays when viewing a commit.
  // Ensures the page works on direct URL navigation.
  use$(() => {
    if (!prCommitId || !prId) return undefined;
    const filter: Filter = { kinds: [PATCH_KIND, PR_KIND], ids: [prId] };
    if (resolved?.repoRelayGroup) {
      return withGapFill(
        resolved.repoRelayGroup.subscription([filter]),
        pool,
        () => resolved.repoRelayGroup.relays.map((r) => r.url),
        [filter],
      ).pipe(onlyEvents(), mapEventsToStore(store));
    }
    return undefined;
  }, [prCommitId, prId, resolved?.repoRelayGroup, store]);

  // Reactively determine if the root event is a patch or PR.
  const rootEvent = use$(() => {
    if (!prCommitId || !prId) return undefined;
    const filter: Filter = { kinds: [PATCH_KIND, PR_KIND], ids: [prId] };
    return store.timeline([filter]);
  }, [prCommitId, prId, store]);

  const rootEventKind = rootEvent?.[0]?.kind;
  const isPatch = rootEventKind === PATCH_KIND;
  const rootEventLoaded = rootEvent !== undefined && rootEvent.length > 0;

  // Load the patch chain when this is a patch-type item and we're on a commit detail.
  const commitDetailPatchChain = usePatchChain(
    prCommitId && isPatch ? prId : undefined,
    resolved?.repoRelayGroup,
  );

  // Resolve the merge base for the commit detail patch chain.
  const commitDetailPatchMergeBase = usePatchMergeBase(
    prCommitId && isPatch ? commitDetailPatchChain.chain : undefined,
    gitPool,
    gitPoolState,
  );

  // Find the patch whose commit tag or event ID matches the requested commit ID.
  const patchMatch = useMemo(() => {
    if (!prCommitId || !isPatch || commitDetailPatchChain.loading)
      return undefined;

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
    for (const patch of commitDetailPatchChain.chain) {
      const result = matchPatch(patch, false);
      if (result) return result;
    }

    // Also check all revisions — earlier ones are superseded
    const latestRevisionIdx = commitDetailPatchChain.allRevisions.length - 1;
    for (let i = 0; i < commitDetailPatchChain.allRevisions.length; i++) {
      const revision = commitDetailPatchChain.allRevisions[i];
      const isSuperseded = i < latestRevisionIdx;
      for (const patch of revision.chain) {
        const result = matchPatch(patch, isSuperseded);
        if (result) return result;
      }
    }

    return undefined;
  }, [
    prCommitId,
    isPatch,
    commitDetailPatchChain.chain,
    commitDetailPatchChain.allRevisions,
    commitDetailPatchChain.loading,
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

  // ── Tab bar (Link-based so it works from any sub-path) ────────────────
  const tabBar = (
    <div className="flex gap-0">
      <TabBarLink
        to={prBasePath ?? ""}
        active={activeTab === "conversation"}
        icon={<MessageCircle className="h-3.5 w-3.5" />}
        label="Conversation"
        badge={pr ? String(pr.commentCount) : undefined}
      />

      {(pr?.itemType === "pr" ||
        (pr?.itemType === "patch" && patchChain && patchChain.length > 0)) && (
        <TabBarLink
          to={prBasePath ? `${prBasePath}/files` : ""}
          active={activeTab === "files"}
          icon={<FileDiff className="h-3.5 w-3.5" />}
          label="Files Changed"
          badge={
            effectiveFileCount !== undefined && effectiveFileCount > 0
              ? String(effectiveFileCount)
              : undefined
          }
        />
      )}

      {((pr?.itemType === "pr" && pr.tip.commitId) ||
        (patchChain && patchChain.length > 0)) && (
        <TabBarLink
          to={prBasePath ? `${prBasePath}/commits` : ""}
          active={activeTab === "commits"}
          icon={<GitCommitHorizontal className="h-3.5 w-3.5" />}
          label="Commits"
          badge={
            pr?.itemType === "pr"
              ? prCommits.length > 0
                ? String(prCommits.length)
                : undefined
              : patchChain && patchChain.length > 0
                ? String(patchChain.length)
                : undefined
          }
        />
      )}
    </div>
  );

  // ── Commit detail content ─────────────────────────────────────────────
  // When prCommitId is set, render the commit detail instead of tab panels.
  const commitDetailContent = useMemo(() => {
    if (!prCommitId) return null;

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
    if (isPatch && commitDetailPatchChain.loading) {
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
          pool={gitPool}
          poolWinnerUrl={gitPoolState.winnerUrl}
          fallbackUrls={[...cloneUrls, ...prCloneUrls]}
          basePath={prBasePath ?? ""}
          repoBasePath={repoBasePath}
          backTo={prBasePath ? `${prBasePath}/commits` : ".."}
          backLabel="PR commits"
          hasCommitId={patchMatch.hasCommitId}
          patchChain={commitDetailPatchChain.chain}
          defaultBranchHead={gitPoolState.latestCommit?.hash}
          superseded={patchMatch.superseded}
          isBaseGuessed={commitDetailPatchMergeBase.isGuessed}
          guessedBaseCommitId={
            commitDetailPatchMergeBase.isGuessed
              ? commitDetailPatchMergeBase.baseCommitId
              : undefined
          }
          baseCommitId={commitDetailPatchMergeBase.baseCommitId}
          relayHints={repoRelayHints}
        />
      );
    }

    // Patch-type: patch chain loaded but commit not found
    if (isPatch && !commitDetailPatchChain.loading && !patchMatch) {
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
    if (!gitPool) return null;

    return (
      <CommitDetailView
        commitId={prCommitId}
        pool={gitPool}
        basePath={prBasePath ?? ""}
        backTo={prBasePath ? `${prBasePath}/commits` : ".."}
        backLabel="PR commits"
        fallbackUrls={prCloneUrls}
      />
    );
  }, [
    prCommitId,
    rootEventLoaded,
    isPatch,
    commitDetailPatchChain.loading,
    commitDetailPatchChain.chain,
    patchMatch,
    gitPool,
    gitPoolState.winnerUrl,
    gitPoolState.latestCommit?.hash,
    cloneUrls,
    prCloneUrls,
    prBasePath,
    repoBasePath,
    commitDetailPatchMergeBase.isGuessed,
    commitDetailPatchMergeBase.baseCommitId,
    repoRelayHints,
  ]);

  // ── Not-found / searching / deleted / vanished state ─────────────────────
  // Show skeleton first, then reveal the relay-status page after a short
  // delay. The timer starts as soon as the search begins and is never reset
  // by transient gaps (e.g. relay group changes mid-search). It only resets
  // when the item ID changes (new navigation).
  const [searchDelayElapsed, setSearchDelayElapsed] = useState(false);
  useEffect(() => {
    setSearchDelayElapsed(false);
    const timer = setTimeout(() => setSearchDelayElapsed(true), 1500);
    return () => clearTimeout(timer);
  }, [prId]);

  const showSearchStatus = !pr && search && searchDelayElapsed && !search.found;

  if (showSearchStatus) {
    const repoBasePath = repoToPath(
      pubkey,
      repoId,
      resolved?.repo?.relays ?? [],
      nip05,
    );
    return (
      <EventSearchStatus
        search={search}
        eventId={prId}
        itemLabel="PR"
        backPath={`${repoBasePath}/prs`}
        backLabel="Back to PRs"
        onSearchMore={
          !searchMoreActive && search.settled ? handleSearchMore : undefined
        }
        searchMoreActive={searchMoreActive}
      />
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      {/* PR header */}
      <div className="border-b border-border/40">
        <div className="container max-w-screen-xl px-4 md:px-8 pt-6 pb-0">
          {pr ? (
            <div className="flex flex-wrap items-end justify-between gap-x-4">
              {/* Left: title + meta */}
              <div className="min-w-0 pb-4">
                <div className="flex items-start gap-3 mb-3">
                  <StatusBadge
                    status={pr.status}
                    variant="pr"
                    className="mt-1 shrink-0"
                  />
                  <EditableSubject
                    issueId={pr.rootEvent.id}
                    currentSubject={pr.currentSubject || pr.originalSubject}
                    canEdit={canEdit}
                    repoCoords={pr.repoCoords}
                  />
                </div>

                <div className="flex items-center gap-4 flex-wrap text-sm text-muted-foreground ml-[calc(theme(spacing.3)+4.5rem-3.5rem)]">
                  <div className="flex items-center gap-1">
                    <TypeIcon className="h-3.5 w-3.5" />
                    <span className="text-xs capitalize">{pr.itemType}</span>
                  </div>
                  <UserLink
                    pubkey={pr.pubkey}
                    avatarSize="sm"
                    nameClassName="text-sm"
                  />
                  <div className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    <span>
                      {formatDistanceToNow(new Date(pr.createdAt * 1000), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  {pr.labels.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {pr.labels.map((label) => (
                        <LabelBadge key={label} label={label} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: tabs */}
              <div className="shrink-0">{tabBar}</div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-3">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-7 w-96" />
              </div>
              <div className="flex gap-3">
                <Skeleton className="h-6 w-6 rounded-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        {/* Commit detail view — shown instead of tab panels when on a commit URL */}
        {prCommitId ? (
          commitDetailContent
        ) : (
          <div
            className={cn(
              "grid gap-6",
              activeTab === "files"
                ? "grid-cols-1"
                : "grid-cols-1 lg:grid-cols-[1fr_280px]",
            )}
          >
            {/* Main content — tabbed */}
            <div className="space-y-4 min-w-0">
              {/* Conversation tab */}
              <TabsContent value="conversation" className="space-y-4 mt-0">
                {/* Cover note — pinned note from author/maintainer */}
                {coverNoteEditing && pr ? (
                  <CoverNoteBox
                    rootEvent={pr.rootEvent}
                    repoCoords={pr.repoCoords}
                    initialContent={pr.coverNotes?.[0]?.content ?? ""}
                    onSubmitted={handleCoverNoteSubmitted}
                    onCancel={handleCoverNoteCancel}
                    priorityPubkeys={mentionPriorityPubkeys}
                  />
                ) : pr?.coverNotes && pr.coverNotes.length > 0 ? (
                  <CoverNoteCard
                    events={pr.coverNotes}
                    onEdit={
                      canEdit ? () => setCoverNoteEditing(true) : undefined
                    }
                  />
                ) : canEdit && pr ? (
                  /* Subtle "Add cover note" button — only for authorised users */
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCoverNoteEditing(true)}
                    className="gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground h-7 -ml-2"
                  >
                    <Pin className="h-3 w-3" />
                    Add cover note
                  </Button>
                ) : null}

                {/* PR / patch body */}
                {pr ? (
                  <EventBodyCard
                    event={pr.rootEvent}
                    content={pr.body}
                    commits={
                      pr.itemType === "pr" && prCommits.length > 0
                        ? prCommits.map((c) => ({
                            hash: c.hash,
                            subject: c.message.split("\n")[0],
                            href: prBasePath
                              ? `${prBasePath}/commit/${c.hash}`
                              : undefined,
                          }))
                        : pr.itemType === "patch" &&
                            pr.initialPatchCommits &&
                            pr.initialPatchCommits.length > 0
                          ? pr.initialPatchCommits.map((c) => ({
                              hash: c.commitId ?? c.eventId,
                              subject: c.subject,
                              noCommitId: !c.commitId,
                              href: prBasePath
                                ? `${prBasePath}/commit/${eventIdToNevent(c.eventId, repoRelayHints)}`
                                : undefined,
                            }))
                          : undefined
                    }
                    commitsSuperseded={
                      pr.itemType === "patch" &&
                      pr.firstRevisionInlined === true &&
                      pr.revisions.length > 1
                    }
                    commitsLatestHref={
                      pr.itemType === "patch" &&
                      pr.firstRevisionInlined === true &&
                      pr.revisions.length > 1 &&
                      prBasePath
                        ? `${prBasePath}/commits`
                        : undefined
                    }
                    hasCoverLetter={
                      pr.itemType === "patch" && !!pr.hasCoverLetter
                    }
                  />
                ) : (
                  <EventBodyCardSkeleton />
                )}

                {/* Interleaved timeline */}
                <div className="space-y-1">
                  <Separator />

                  {!pr ? (
                    <div className="space-y-3 pt-3">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <CommentSkeleton key={i} />
                      ))}
                    </div>
                  ) : pr.timelineNodes.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground/60 text-sm">
                      No activity yet. The conversation awaits its first voice.
                    </div>
                  ) : (
                    <div
                      className="min-w-0 border-l pl-1 space-y-0.5"
                      style={{ borderLeftColor: "rgb(59 130 246 / 0.5)" }}
                    >
                      {((): React.ReactNode => {
                        // Track revision number (1-based) as we walk the timeline.
                        let revisionCounter = 0;
                        return pr.timelineNodes.map((node, idx) => {
                          if (node.type === "revision") {
                            if (
                              node.revision.type === "patch-set" &&
                              node.revision.patches &&
                              node.revision.patches.length > 0
                            ) {
                              // Always count this revision, even if we skip rendering it
                              // (inlined into the body card), so subsequent revisions
                              // get the correct revision number.
                              revisionCounter += 1;
                              // Skip the original (non-revision) patch-set when it
                              // has been inlined into the body card.
                              if (
                                pr.firstRevisionInlined &&
                                !node.revision.patches[0].isRootRevision
                              ) {
                                return null;
                              }
                              const currentRevNum = revisionCounter;
                              const rootPatch = node.revision.patches[0];
                              return (
                                <PatchSetPushEvent
                                  key={`patch-push-${node.revision.rootPatchEvent?.id ?? idx}`}
                                  revision={{
                                    rootPatch,
                                    chain: node.revision.patches,
                                    isRevision:
                                      node.revision.superseded ||
                                      rootPatch.isRootRevision,
                                  }}
                                  superseded={node.revision.superseded}
                                  basePath={prBasePath ?? undefined}
                                  revisionNumber={currentRevNum}
                                  relayHints={repoRelayHints}
                                />
                              );
                            }
                            if (
                              node.revision.type === "pr-update" &&
                              node.revision.updateEvent
                            ) {
                              revisionCounter += 1;
                              const currentRevNum = revisionCounter;
                              return (
                                <PRUpdatePushEvent
                                  key={`pr-update-${node.revision.updateEvent.id}`}
                                  update={{
                                    event: node.revision.updateEvent,
                                    pubkey: node.revision.pubkey,
                                    tipCommitId: node.revision.tipCommitId,
                                    mergeBase: node.revision.mergeBase,
                                  }}
                                  superseded={node.revision.superseded}
                                  basePath={prBasePath ?? undefined}
                                  revisionNumber={currentRevNum}
                                />
                              );
                            }
                            return null;
                          }
                          if (node.type === "rename") {
                            return (
                              <SubjectRenameCard
                                key={node.event.id}
                                event={node.event}
                                oldSubject={node.oldSubject}
                                newSubject={node.newSubject}
                              />
                            );
                          }
                          if (node.type === "status") {
                            return (
                              <StatusChangeCard
                                key={node.event.id}
                                event={node.event}
                                status={node.status}
                                authorised={node.authorised}
                                variant="pr"
                              />
                            );
                          }
                          if (node.type === "label") {
                            return (
                              <LabelChangeCard
                                key={node.event.id}
                                event={node.event}
                                labels={node.labels}
                                authorised={node.authorised}
                              />
                            );
                          }
                          // thread node
                          return (
                            <ThreadTree
                              key={`thread-${node.node.event.id}-${idx}`}
                              node={node.node}
                              threadContext={
                                activeAccount && pr
                                  ? {
                                      rootEvent: pr.rootEvent,
                                      repoCoords: pr.repoCoords,
                                      priorityPubkeys: mentionPriorityPubkeys,
                                    }
                                  : undefined
                              }
                            />
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>

                {/* Merge panel — shown for patch-type PRs on Grasp repos, for maintainers */}
                {pr &&
                  repo &&
                  pr.itemType === "patch" &&
                  repo.graspCloneUrls.length > 0 &&
                  isMaintainer &&
                  (pr.status === "open" || pr.status === "draft") &&
                  patchChain &&
                  patchChain.length > 0 && (
                    <MergePanel
                      pr={pr}
                      repo={repo}
                      patchChain={patchChain}
                      gitPool={gitPool}
                      effectiveCloneUrls={effectiveCloneUrls}
                      behindCount={behindCount}
                      defaultBranchName={defaultBranchName ?? "main"}
                      defaultBranchHead={
                        defaultBranchHead ?? repoState?.headCommitId
                      }
                      guessedBaseCommitId={
                        patchMergeBase.isGuessed
                          ? patchMergeBase.baseCommitId
                          : undefined
                      }
                    />
                  )}

                {/* Reply box — always shown; anonymous posting handled inside */}
                {pr && (
                  <ReplyBox
                    rootEvent={
                      // For patches with multiple revisions, comments go to the
                      // latest revision's root patch event (not the original root).
                      // PR / PR Update kinds don't have this concept — they always
                      // thread under the original root event.
                      pr.itemType === "patch" &&
                      pr.revisions.length > 1 &&
                      pr.revisions[pr.revisions.length - 1].rootPatchEvent
                        ? pr.revisions[pr.revisions.length - 1].rootPatchEvent!
                        : pr.rootEvent
                    }
                    priorityPubkeys={mentionPriorityPubkeys}
                  />
                )}
              </TabsContent>

              {/* Files Changed tab */}
              {(pr?.itemType === "pr" ||
                (pr?.itemType === "patch" &&
                  patchChain &&
                  patchChain.length > 0)) && (
                <TabsContent value="files" className="mt-0 min-w-0">
                  {pr?.itemType === "patch" && patchChain ? (
                    <PatchFilesTab
                      chain={patchChain}
                      baseCommitId={patchMergeBase.baseCommitId}
                      isBaseGuessed={patchMergeBase.isGuessed}
                      defaultBranchHead={defaultBranchHead}
                      pool={gitPool}
                      onFileCountChange={(count) => {
                        if (pr?.itemType === "patch") setFileCount(count);
                      }}
                      onApplyResult={setPatchApplyResult}
                      fallbackUrls={effectiveCloneUrls}
                      basePath={prBasePath ?? undefined}
                      relayHints={repoRelayHints}
                    />
                  ) : !pr?.tip.commitId ? (
                    <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                      {pr
                        ? "This item does not include a tip commit ID."
                        : "Loading data..."}
                    </div>
                  ) : !effectiveMergeBase ? (
                    <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                      {computingMergeBase
                        ? "Determining base commit..."
                        : "Could not determine the base commit."}
                    </div>
                  ) : !gitPool ? (
                    <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                      Connecting to git server...
                    </div>
                  ) : (
                    <PRFilesTab
                      tipCommitId={pr.tip.commitId}
                      baseCommitId={effectiveMergeBase}
                      pool={gitPool}
                      fallbackUrls={effectiveCloneUrls}
                    />
                  )}
                </TabsContent>
              )}

              {/* Commits tab */}
              {((pr?.itemType === "pr" && pr.tip.commitId) ||
                (patchChain && patchChain.length > 0)) && (
                <TabsContent value="commits" className="mt-0">
                  {pr?.itemType === "pr" ? (
                    !effectiveMergeBase ? (
                      <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                        {computingMergeBase
                          ? "Determining base commit..."
                          : "Could not determine the base commit for this PR."}
                      </div>
                    ) : prCommitHistory.error ? (
                      <CommitListError message={prCommitHistory.error} />
                    ) : prCommitHistory.loading ? (
                      <CommitListLoading count={4} />
                    ) : prCommits.length === 0 ? (
                      <CommitListEmpty message="No commits found for this PR." />
                    ) : (
                      <CommitList
                        commits={prCommits}
                        basePath={
                          prBasePath ??
                          repoToPath(pubkey, repoId, repo?.relays ?? [], nip05)
                        }
                      />
                    )
                  ) : patchChain && patchChain.length > 0 ? (
                    <PatchCommitList
                      patches={patchChain}
                      basePath={
                        prBasePath ??
                        repoToPath(pubkey, repoId, repo?.relays ?? [], nip05)
                      }
                      relayHints={repoRelayHints}
                      isBaseGuessed={patchMergeBase.isGuessed}
                      applyResult={patchApplyResult}
                    />
                  ) : (
                    <CommitListEmpty message="No patches found in this patch set." />
                  )}
                </TabsContent>
              )}
            </div>

            {/* Sidebar */}
            <div className={cn("space-y-4", activeTab === "files" && "hidden")}>
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Status
                    </span>
                    <StatusBadge status={pr?.status ?? "open"} variant="pr" />
                  </div>

                  {canEdit && pr && pr.status !== "deleted" && (
                    <ChangeStatusDropdown
                      itemId={pr.rootEvent.id}
                      itemAuthorPubkey={pr.pubkey}
                      repoCoords={pr.repoCoords}
                      currentStatus={pr.status}
                      options={[
                        { value: "open", label: "Open" },
                        { value: "resolved", label: "Merged" },
                        { value: "closed", label: "Closed" },
                        { value: "draft", label: "Draft" },
                      ]}
                    />
                  )}

                  {/* Ahead / behind */}
                  {(aheadCount !== undefined || behindCount !== undefined) && (
                    <>
                      <Separator />
                      <div className="flex items-start gap-2 text-sm">
                        <GitCommitHorizontal className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="space-y-0.5">
                          {aheadCount !== undefined && (
                            <p className="text-foreground font-medium">
                              {aheadCount} commit{aheadCount !== 1 ? "s" : ""}{" "}
                              <span className="font-normal text-muted-foreground">
                                ahead
                              </span>
                            </p>
                          )}
                          {behindCount !== undefined && (
                            <p className="text-foreground font-medium">
                              {behindCount} commit{behindCount !== 1 ? "s" : ""}{" "}
                              <span className="font-normal text-muted-foreground">
                                behind
                              </span>
                            </p>
                          )}
                          {defaultBranchName && (
                            <p className="text-xs text-muted-foreground">
                              vs{" "}
                              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                                {defaultBranchName}
                              </code>
                            </p>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <MessageCircle className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Comments</span>
                      <span className="ml-auto font-medium">
                        {pr?.commentCount ?? 0}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                      <Zap className="h-4 w-4 text-amber-500" />
                      <span className="text-muted-foreground">Zaps</span>
                      <span className="ml-auto font-medium">
                        {pr?.zapCount ?? 0}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        Participants
                      </span>
                      <span className="ml-auto font-medium">
                        {pr?.participants.length ?? 0}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  {/* Participant avatars */}
                  {pr && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">
                        Participants
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {pr.participants.map((pk) => (
                          <UserAvatar
                            key={pk}
                            pubkey={pk}
                            size="sm"
                            linkToProfile
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Labels */}
                  {pr && pr.labels.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs text-muted-foreground mb-2">
                          Labels
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {pr.labels.map((label) => (
                            <LabelBadge key={label} label={label} />
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Back link */}
              <Link
                to={`${repoToPath(pubkey, repoId, repo?.relays ?? [], nip05)}/prs`}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to PRs
              </Link>
            </div>
          </div>
        )}
      </div>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// TabBarLink — Link-based tab trigger that works across all PR sub-paths
// ---------------------------------------------------------------------------

function TabBarLink({
  to,
  active,
  icon,
  label,
  badge,
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm rounded-none px-3 pb-2 pt-1 border-b-2 transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
      {badge !== undefined && (
        <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs font-medium leading-none">
          {badge}
        </span>
      )}
    </Link>
  );
}
