import { useEffect, useMemo, useRef, useState } from "react";
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
  ThreadedComments,
} from "@/components/EventThreadComponents";
import { getThreadTree } from "@/lib/threadTree";

import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import {
  usePRComments,
  usePRLabels,
  usePRStatus,
  usePRTip,
  usePRZaps,
  usePRSubjectRenames,
  usePRMaintainers,
  resolveCurrentPRSubject,
} from "@/hooks/usePRs";
import { useNip34Loaders } from "@/hooks/useNip34Loaders";
import { useRepoContext } from "@/pages/repo/RepoContext";
import { useGitPool } from "@/hooks/useGitPool";
import { UserAvatar, UserLink } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { LabelBadge } from "@/components/LabelBadge";
import { ChangeStatusDropdown } from "@/components/ChangeStatusDropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft,
  MessageCircle,
  Zap,
  Users,
  Clock,
  GitPullRequest,
  GitCommitHorizontal,
  FileDiff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PR_ROOT_KINDS, PR_KIND, PATCH_KIND } from "@/lib/nip34";
import { PR } from "@/casts/PR";
import { Patch } from "@/casts/Patch";
import { DiffView } from "@/components/DiffView";
import { PRFilesTab } from "@/components/PRFilesTab";
import { diffTrees } from "@/lib/git-grasp-pool";
import {
  CommitList,
  CommitListLoading,
  CommitListEmpty,
  CommitListError,
} from "@/components/CommitList";
import { useCommitHistory } from "@/hooks/useGitExplorer";
import { gitIndexRelays, relayCurationMode } from "@/services/settings";
import { pool } from "@/services/nostr";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { castTimelineStream } from "applesauce-common/observable";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";

export default function PRPage() {
  const { pubkey, repoId, resolved, prId, cloneUrls, prBasePath } =
    useRepoContext();
  const location = useLocation();
  const navigate = useNavigate();
  const repo = resolved?.repo;
  const repoRelayGroup = resolved?.repoRelayGroup;
  const extraRelaysForMaintainerMailboxCoverage =
    resolved?.extraRelaysForMaintainerMailboxCoverage;

  const curationMode = use$(relayCurationMode);
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  // Git pool — uses the repo's clone URLs (same as RepoCodePage).
  const { pool: gitPool, poolState: gitPoolState } = useGitPool(cloneUrls);

  // Derive the active tab from the URL so that navigating to
  // prs/<id>/commits lands on the commits tab, and clicking a tab updates
  // the route accordingly.
  const activeTab = useMemo(() => {
    const p = location.pathname;
    if (p.endsWith("/commits")) return "commits";
    if (p.endsWith("/files")) return "files";
    if (p.endsWith("/patch")) return "patch";
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

  // Fetch the PR/patch event via the repo relay group when available;
  // fall back to git index relays for initial discovery.
  use$(() => {
    if (!prId) return undefined;
    const filters: Filter[] = [{ kinds: [...PR_ROOT_KINDS], ids: [prId] }];
    if (repoRelayGroup) {
      return repoRelayGroup
        .subscription(filters)
        .pipe(onlyEvents(), mapEventsToStore(store));
    }
    return pool
      .subscription(gitIndexRelays.getValue(), filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [prId, repoRelayGroup, store]);

  // In outbox mode, also fetch from extra maintainer mailbox relays.
  use$(() => {
    if (
      !prId ||
      curationMode !== "outbox" ||
      !extraRelaysForMaintainerMailboxCoverage
    )
      return undefined;
    const filters: Filter[] = [{ kinds: [...PR_ROOT_KINDS], ids: [prId] }];
    return extraRelaysForMaintainerMailboxCoverage
      .subscription(filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [prId, curationMode, extraRelaysForMaintainerMailboxCoverage, store]);

  // Subscribe to the store and cast to PR (kind 1618).
  const prs = use$(() => {
    if (!prId) return undefined;
    const filters: Filter[] = [{ kinds: [PR_KIND], ids: [prId] }];
    return store
      .timeline(filters)
      .pipe(castTimelineStream(PR, castStore)) as unknown as Observable<PR[]>;
  }, [prId, store]);

  // Subscribe to the store and cast to Patch (kind 1617).
  const patches = use$(() => {
    if (!prId) return undefined;
    const filters: Filter[] = [{ kinds: [PATCH_KIND], ids: [prId] }];
    return store
      .timeline(filters)
      .pipe(castTimelineStream(Patch, castStore)) as unknown as Observable<
      Patch[]
    >;
  }, [prId, store]);

  // Exactly one of these will be populated — the event is either a PR or a patch.
  const pr = prs?.[0];
  const patch = patches?.[0];
  const prEvent = pr?.event ?? patch?.event;
  const itemType = patch ? "patch" : "pr";

  // Trigger two-tier loading for this PR/patch.
  useNip34Loaders(prId, repoRelayGroup, {
    includeAuthorNip65: curationMode === "outbox",
  });

  // Compute the effective maintainer set.
  const selectedMaintainers = useMemo(
    () => (repo?.maintainerSet ? new Set(repo.maintainerSet) : undefined),
    [repo?.maintainerSet],
  );
  usePRMaintainers(prId, selectedMaintainers);

  const prPubkey = prEvent?.pubkey;

  // Latest authorised PR Update tip (kind:1619) — falls back to the original
  // PR event's c/merge-base tags when no authorised updates exist.
  const prTip = usePRTip(prId, prPubkey, selectedMaintainers);
  const effectiveTipCommitId = prTip?.tipCommitId ?? pr?.tipCommitId;
  const effectiveMergeBase = prTip?.mergeBase ?? pr?.mergeBase;

  // Clone URLs from the PR event and the latest PR Update — used as per-operation
  // fallback sources when fetching git data specific to this PR.
  const prCloneUrls = useMemo(() => {
    const urls = [...(pr?.cloneUrls ?? []), ...(prTip?.cloneUrls ?? [])];
    // Deduplicate while preserving order
    return Array.from(new Set(urls));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr?.cloneUrls?.join(","), prTip?.cloneUrls?.join(",")]);

  // Commit history for the PR commits tab — fetches from the effective tip.
  const prCommitHistory = useCommitHistory(
    gitPool,
    gitPoolState,
    effectiveTipCommitId,
    100,
    prCloneUrls,
  );
  const prCommits = useMemo(() => {
    if (!effectiveMergeBase || !prCommitHistory.commits.length)
      return prCommitHistory.commits;
    const idx = prCommitHistory.commits.findIndex(
      (c) => c.hash === effectiveMergeBase,
    );
    return idx === -1
      ? prCommitHistory.commits
      : prCommitHistory.commits.slice(0, idx);
  }, [prCommitHistory.commits, effectiveMergeBase]);

  // Eagerly compute file count as soon as the git pool + commit IDs are ready,
  // so the tab badge shows without the user having to visit the Files tab first.
  const [fileCount, setFileCount] = useState<number | undefined>(undefined);
  const fileCountAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!gitPool || !effectiveTipCommitId || !effectiveMergeBase) return;

    fileCountAbortRef.current?.abort();
    const abort = new AbortController();
    fileCountAbortRef.current = abort;

    gitPool
      .getCommitRange(
        effectiveTipCommitId,
        effectiveMergeBase,
        abort.signal,
        prCloneUrls,
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
  }, [gitPool, effectiveTipCommitId, effectiveMergeBase, prCloneUrls]);

  const status = usePRStatus(prId, prPubkey, selectedMaintainers);
  const nip32Labels = usePRLabels(prId, prPubkey, selectedMaintainers);
  const comments = usePRComments(prId);
  const zaps = usePRZaps(prId);
  const subjectRenames = usePRSubjectRenames(
    prId,
    prPubkey,
    selectedMaintainers,
  );

  // Resolve the current (effective) subject from rename events.
  const originalSubject = pr?.subject ?? patch?.subject ?? "";
  const currentSubject = resolveCurrentPRSubject(
    originalSubject,
    subjectRenames,
  );

  // Authorisation: can the logged-in user edit the subject / status?
  const activeAccount = useActiveAccount();
  const canEdit = useMemo(() => {
    if (!activeAccount || !prEvent) return false;
    const pk = activeAccount.pubkey;
    if (pk === prEvent.pubkey) return true;
    return selectedMaintainers?.has(pk) ?? false;
  }, [activeAccount, prEvent, selectedMaintainers]);
  const canEditSubject = canEdit;

  // Merge labels from the event's own t-tags with NIP-32 label events.
  const allLabels = useMemo(() => {
    const eventLabels = pr?.labels ?? patch?.labels ?? [];
    const merged = new Set([...eventLabels, ...nip32Labels]);
    return Array.from(merged).sort();
  }, [pr?.labels, patch?.labels, nip32Labels]);

  // Participants: author + comment authors
  const participants = useMemo(() => {
    const pubkeys = new Set<string>();
    if (prEvent) pubkeys.add(prEvent.pubkey);
    if (comments) {
      for (const c of comments) pubkeys.add(c.pubkey);
    }
    return Array.from(pubkeys);
  }, [prEvent, comments]);

  // Build the thread tree from the PR event + comments.
  const threadTree = useMemo(() => {
    if (!prEvent || !comments) return undefined;
    return getThreadTree(prEvent, comments);
  }, [prEvent, comments]);

  // Compute subject rename items with old/new subjects for display.
  const renameItems = useMemo(() => {
    if (!subjectRenames || subjectRenames.length === 0) return [];
    let prevSubject = originalSubject;
    return subjectRenames.map((ev) => {
      const newSubject =
        ev.tags.find(([t, , ns]) => t === "l" && ns === "#subject")?.[1] ??
        prevSubject;
      const item = { event: ev, newSubject, oldSubject: prevSubject };
      prevSubject = newSubject;
      return item;
    });
  }, [subjectRenames, originalSubject]);

  const TypeIcon = itemType === "patch" ? GitCommitHorizontal : GitPullRequest;

  const body = pr?.body ?? patch?.body ?? "";

  useSeoMeta({
    title: prEvent
      ? `${currentSubject || originalSubject} - ngit`
      : "PR - ngit",
    description: body.slice(0, 160) || "Loading PR...",
  });

  // Tab bar rendered in the PR header, bottom-right on desktop, below meta on mobile.
  // Uses underline style: transparent background, active tab gets a bottom border indicator.
  const tabList = (
    <TabsList className="h-auto bg-transparent p-0 gap-0 rounded-none border-0">
      <TabsTrigger
        value="conversation"
        className="gap-1.5 text-sm rounded-none px-3 pb-2 pt-1 h-auto border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        Conversation
        {comments !== undefined && (
          <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs font-medium leading-none">
            {comments.length}
          </span>
        )}
      </TabsTrigger>

      {/* Files Changed tab — only for PRs (kind 1618), not raw patches */}
      {itemType === "pr" && (
        <TabsTrigger
          value="files"
          className="gap-1.5 text-sm rounded-none px-3 pb-2 pt-1 h-auto border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent text-muted-foreground hover:text-foreground transition-colors"
        >
          <FileDiff className="h-3.5 w-3.5" />
          Files Changed
          {fileCount !== undefined && fileCount > 0 && (
            <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs font-medium leading-none">
              {fileCount}
            </span>
          )}
        </TabsTrigger>
      )}

      {/* Commits tab — only for PRs with a tip commit */}
      {itemType === "pr" && effectiveTipCommitId && (
        <TabsTrigger
          value="commits"
          className="gap-1.5 text-sm rounded-none px-3 pb-2 pt-1 h-auto border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent text-muted-foreground hover:text-foreground transition-colors"
        >
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          Commits
          {prCommits.length > 0 && (
            <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs font-medium leading-none">
              {prCommits.length}
            </span>
          )}
        </TabsTrigger>
      )}

      {/* Patch diff tab — only for patches (kind 1617) */}
      {patch?.patchDiff && (
        <TabsTrigger
          value="patch"
          className="gap-1.5 text-sm rounded-none px-3 pb-2 pt-1 h-auto border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent text-muted-foreground hover:text-foreground transition-colors"
        >
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          Patch
        </TabsTrigger>
      )}
    </TabsList>
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      {/* PR header */}
      <div className="border-b border-border/40">
        <div className="container max-w-screen-xl px-4 md:px-8 pt-6 pb-0">
          {prEvent ? (
            <div className="flex flex-wrap items-end justify-between gap-x-4">
              {/* Left: title + meta */}
              <div className="min-w-0 pb-4">
                <div className="flex items-start gap-3 mb-3">
                  <StatusBadge
                    status={status}
                    variant="pr"
                    className="mt-1 shrink-0"
                  />
                  <EditableSubject
                    issueId={prEvent.id}
                    currentSubject={currentSubject || originalSubject}
                    canEdit={canEditSubject}
                    repoRelays={repo?.relays}
                  />
                </div>

                <div className="flex items-center gap-4 flex-wrap text-sm text-muted-foreground ml-[calc(theme(spacing.3)+4.5rem-3.5rem)]">
                  <div className="flex items-center gap-1">
                    <TypeIcon className="h-3.5 w-3.5" />
                    <span className="text-xs capitalize">{itemType}</span>
                  </div>
                  <UserLink
                    pubkey={prEvent.pubkey}
                    avatarSize="sm"
                    nameClassName="text-sm"
                  />
                  <div className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    <span>
                      {formatDistanceToNow(
                        new Date(prEvent.created_at * 1000),
                        {
                          addSuffix: true,
                        },
                      )}
                    </span>
                  </div>
                  {allLabels.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {allLabels.map((label) => (
                        <LabelBadge key={label} label={label} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: tabs anchored to bottom-right on desktop, below meta on mobile */}
              <div className="shrink-0">{tabList}</div>
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
              {/* PR body */}
              {prEvent ? (
                <EventBodyCard event={prEvent} content={body} />
              ) : (
                <EventBodyCardSkeleton />
              )}

              {/* Thread: comments + subject renames */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <MessageCircle className="h-4 w-4" />
                  <span>
                    {comments
                      ? `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`
                      : "Loading comments..."}
                  </span>
                </div>

                <Separator />

                {!comments ? (
                  <div className="space-y-3">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <CommentSkeleton key={i} />
                    ))}
                  </div>
                ) : threadTree &&
                  threadTree.children.length === 0 &&
                  renameItems.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground/60 text-sm">
                    No comments yet. The conversation awaits its first voice.
                  </div>
                ) : threadTree ? (
                  <ThreadedComments
                    tree={threadTree}
                    renameItems={renameItems}
                  />
                ) : null}
              </div>
            </TabsContent>

            {/* Files Changed tab */}
            {itemType === "pr" && (
              <TabsContent value="files" className="mt-0 min-w-0">
                {!effectiveTipCommitId ? (
                  <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                    {prEvent
                      ? "This PR does not include a tip commit ID."
                      : "Loading PR data…"}
                  </div>
                ) : !effectiveMergeBase ? (
                  <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                    This PR does not include a merge-base commit. Cannot
                    determine which files changed.
                  </div>
                ) : !gitPool ? (
                  <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                    Connecting to git server…
                  </div>
                ) : (
                  <PRFilesTab
                    tipCommitId={effectiveTipCommitId}
                    baseCommitId={effectiveMergeBase}
                    pool={gitPool}
                    fallbackUrls={prCloneUrls}
                  />
                )}
              </TabsContent>
            )}

            {/* Commits tab */}
            {itemType === "pr" && effectiveTipCommitId && (
              <TabsContent value="commits" className="mt-0">
                {!effectiveMergeBase ? (
                  <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                    This PR does not include a merge-base commit. Cannot
                    determine which commits belong to the PR.
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
                      repoToPath(pubkey, repoId, repo?.relays ?? [])
                    }
                  />
                )}
              </TabsContent>
            )}

            {/* Patch diff tab */}
            {patch?.patchDiff && (
              <TabsContent value="patch" className="mt-0">
                <DiffView diff={patch.patchDiff} />
              </TabsContent>
            )}
          </div>

          {/* Sidebar — hidden on the files tab to give the diff more room */}
          <div className={cn("space-y-4", activeTab === "files" && "hidden")}>
            {/* Stats card */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <StatusBadge status={status} variant="pr" />
                </div>

                {canEdit && prEvent && status !== "deleted" && (
                  <ChangeStatusDropdown
                    itemId={prEvent.id}
                    itemAuthorPubkey={prEvent.pubkey}
                    repoCoords={pr?.repoCoords ?? patch?.repoCoords ?? []}
                    currentStatus={status}
                    options={[
                      { value: "open", label: "Open" },
                      { value: "resolved", label: "Merged" },
                      { value: "closed", label: "Closed" },
                      { value: "draft", label: "Draft" },
                    ]}
                    repoRelays={repo?.relays}
                  />
                )}

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <MessageCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Comments</span>
                    <span className="ml-auto font-medium">
                      {comments?.length ?? 0}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <Zap className="h-4 w-4 text-amber-500" />
                    <span className="text-muted-foreground">Zaps</span>
                    <span className="ml-auto font-medium">
                      {zaps?.length ?? 0}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Participants</span>
                    <span className="ml-auto font-medium">
                      {participants.length}
                    </span>
                  </div>
                </div>

                <Separator />

                {/* Participant avatars */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Participants
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {participants.map((pk) => (
                      <UserAvatar
                        key={pk}
                        pubkey={pk}
                        size="sm"
                        linkToProfile
                      />
                    ))}
                  </div>
                </div>

                {/* Labels */}
                {allLabels.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">
                        Labels
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {allLabels.map((label) => (
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
              to={`${repoToPath(pubkey, repoId, repo?.relays ?? [])}/prs`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to PRs
            </Link>
          </div>
        </div>
      </div>
    </Tabs>
  );
}
