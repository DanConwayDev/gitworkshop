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
  SubjectRenameCard,
} from "@/components/EventThreadComponents";
import { ThreadTree } from "@/components/ThreadTree";
import { getThreadTree } from "@/lib/threadTree";

import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import {
  usePRAllComments,
  usePRLabels,
  usePRStatus,
  usePRTip,
  usePRUpdates,
  usePRZaps,
  usePRSubjectRenames,
  usePRMaintainers,
  resolveCurrentPRSubject,
} from "@/hooks/usePRs";
import {
  useNip34Loaders,
  useNip34ItemLoaderBatch,
} from "@/hooks/useNip34Loaders";
import { usePatchChain } from "@/hooks/usePatchChain";
import { useRepoContext } from "@/pages/repo/RepoContext";
import { useGitPool } from "@/hooks/useGitPool";
import { UserAvatar, UserLink } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { LabelBadge } from "@/components/LabelBadge";
import { ChangeStatusDropdown } from "@/components/ChangeStatusDropdown";
import { ReplyBox } from "@/components/ReplyBox";
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
import {
  PatchSetPushEvent,
  PROpenPushEvent,
  PRUpdatePushEvent,
} from "@/components/PushEventComponents";
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
import { PatchCommitList } from "@/components/PatchCommitList";
import { useCommitHistory } from "@/hooks/useGitExplorer";
import { usePRMergeBase } from "@/hooks/usePRMergeBase";
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

  // For patches: resolve the latest revision chain so we can show Commits and
  // Files Changed tabs. Only active when the root event is a patch (kind 1617).
  const patchChain = usePatchChain(
    itemType === "patch" ? prId : undefined,
    repoRelayGroup,
    cloneUrls,
  );

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

  // Clone URLs from the PR event and the latest PR Update — used as per-operation
  // fallback sources when fetching git data specific to this PR.
  const prCloneUrls = useMemo(() => {
    const urls = [...(pr?.cloneUrls ?? []), ...(prTip?.cloneUrls ?? [])];
    // Deduplicate while preserving order
    return Array.from(new Set(urls));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr?.cloneUrls?.join(","), prTip?.cloneUrls?.join(",")]);

  // The merge-base tag is optional in NIP-34. When absent, derive it by
  // walking the commit chain. Re-runs when the tip changes (e.g. after a rebase).
  const explicitMergeBase = prTip?.mergeBase ?? pr?.mergeBase;
  const { mergeBase: effectiveMergeBase, computing: computingMergeBase } =
    usePRMergeBase(
      gitPool,
      gitPoolState,
      effectiveTipCommitId,
      explicitMergeBase,
      prCloneUrls,
    );

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

  // ── Patch-specific git data ────────────────────────────────────────────────
  // For patches with commit IDs in their tags, we can show a Files Changed tab
  // using the git pool (tip = last patch's commit, base = first patch's parent-commit).
  // Clone URLs come from the patch chain (some clients include them) plus the
  // repo's own clone URLs.
  const patchCloneUrls = useMemo(() => {
    const urls = [...patchChain.cloneUrls, ...cloneUrls];
    return Array.from(new Set(urls));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchChain.cloneUrls.join(","), cloneUrls.join(",")]);

  const patchTipCommitId = patchChain.tipCommitId;
  const patchBaseCommitId = patchChain.baseCommitId;

  // Derive merge base for patches: use the explicit parent-commit from the
  // first patch's tag, or fall back to walking the commit chain.
  const { mergeBase: patchMergeBase, computing: computingPatchMergeBase } =
    usePRMergeBase(
      itemType === "patch" ? gitPool : null,
      gitPoolState,
      patchTipCommitId,
      patchBaseCommitId,
      patchCloneUrls,
    );

  // Eagerly compute file count as soon as the git pool + commit IDs are ready,
  // so the tab badge shows without the user having to visit the Files tab first.
  const [fileCount, setFileCount] = useState<number | undefined>(undefined);
  const fileCountAbortRef = useRef<AbortController | null>(null);

  // Effective tip/base for file count — PR uses prTip/mergeBase, patch uses patchChain
  const fileCountTipId =
    itemType === "pr" ? effectiveTipCommitId : patchTipCommitId;
  const fileCountBaseId =
    itemType === "pr" ? effectiveMergeBase : patchMergeBase;
  const fileCountFallbackUrls =
    itemType === "pr" ? prCloneUrls : patchCloneUrls;

  useEffect(() => {
    if (!gitPool || !fileCountTipId || !fileCountBaseId) return;

    fileCountAbortRef.current?.abort();
    const abort = new AbortController();
    fileCountAbortRef.current = abort;

    gitPool
      .getCommitRange(
        fileCountTipId,
        fileCountBaseId,
        abort.signal,
        fileCountFallbackUrls,
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
  }, [gitPool, fileCountTipId, fileCountBaseId, fileCountFallbackUrls]);

  const status = usePRStatus(prId, prPubkey, selectedMaintainers);
  const nip32Labels = usePRLabels(prId, prPubkey, selectedMaintainers);
  const zaps = usePRZaps(prId);
  const subjectRenames = usePRSubjectRenames(
    prId,
    prPubkey,
    selectedMaintainers,
  );

  // For patches: collect all revision root IDs so we can load their comments
  // and render them in the timeline.
  const revisionRootIds = useMemo(() => {
    if (itemType !== "patch") return [];
    return patchChain.allRevisions
      .filter((r) => r.isRevision)
      .map((r) => r.rootPatch.id);
  }, [itemType, patchChain.allRevisions]);

  // Load essentials + comments + thread for each revision root patch.
  // The singleton loaders batch all IDs together automatically.
  useNip34ItemLoaderBatch(revisionRootIds, repoRelayGroup, {
    tier: "thread",
    includeAuthorNip65: curationMode === "outbox",
  });

  // All comments across the root patch + all revision roots.
  const comments = usePRAllComments(prId, revisionRootIds);

  // PR Updates (kind:1619) — already fetched by nip34CommentsLoader.
  const prUpdates = usePRUpdates(itemType === "pr" ? prId : undefined);

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

  // Participants: author + comment authors + PR update authors
  const participants = useMemo(() => {
    const pubkeys = new Set<string>();
    if (prEvent) pubkeys.add(prEvent.pubkey);
    if (comments) {
      for (const c of comments) pubkeys.add(c.pubkey);
    }
    if (prUpdates) {
      for (const u of prUpdates) pubkeys.add(u.pubkey);
    }
    return Array.from(pubkeys);
  }, [prEvent, comments, prUpdates]);

  // Build the thread tree from the PR event + comments.
  // For patches: exclude comments that belong to a revision root (they'll be
  // shown under their revision's push event instead).
  const revisionRootIdSet = useMemo(
    () => new Set(revisionRootIds),
    [revisionRootIds],
  );
  const rootComments = useMemo(() => {
    if (!comments) return undefined;
    if (itemType !== "patch" || revisionRootIdSet.size === 0) return comments;
    // Keep only comments whose #E root is the original root patch (prId),
    // not a revision root.
    return comments.filter((c) => {
      const rootTag = c.tags.find((t) => t[0] === "E");
      if (!rootTag) return true; // no root tag — keep
      return rootTag[1] === prId; // only keep if rooted at the original
    });
  }, [comments, itemType, revisionRootIdSet, prId]);

  const threadTree = useMemo(() => {
    if (!prEvent || !rootComments) return undefined;
    return getThreadTree(prEvent, rootComments);
  }, [prEvent, rootComments]);

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

  // Build the interleaved push+comment timeline for the conversation tab.
  // For patches: one PatchSetPushEvent per revision, interleaved with comments.
  // For PRs: one PRUpdatePushEvent per kind:1619 update, interleaved with comments.
  type TimelineNode =
    | {
        type: "patch-push";
        revision: (typeof patchChain.allRevisions)[0];
        superseded: boolean;
        ts: number;
      }
    | {
        type: "pr-open";
        pr: NonNullable<typeof pr>;
        superseded: boolean;
        commits: Array<{ hash: string; subject: string }>;
        ts: number;
      }
    | {
        type: "pr-update";
        update: NonNullable<typeof prUpdates>[0];
        superseded: boolean;
        ts: number;
      }
    | { type: "rename"; item: (typeof renameItems)[0]; ts: number }
    | {
        type: "thread";
        node: import("@/lib/threadTree").ThreadTreeNode;
        ts: number;
      };

  const conversationTimeline = useMemo((): TimelineNode[] => {
    const nodes: TimelineNode[] = [];

    if (itemType === "patch") {
      // Push events: one per revision (original + revisions)
      const revisions = patchChain.allRevisions;
      revisions.forEach((rev, idx) => {
        const superseded = idx < revisions.length - 1;
        nodes.push({
          type: "patch-push",
          revision: rev,
          superseded,
          ts: rev.rootPatch.event.created_at,
        });
        // Comments rooted at this revision's root patch
        if (idx > 0 && comments) {
          const revId = rev.rootPatch.id;
          const revComments = comments.filter((c) => {
            const rootTag = c.tags.find((t) => t[0] === "E");
            return rootTag?.[1] === revId;
          });
          if (revComments.length > 0 && prEvent) {
            const revTree = getThreadTree(rev.rootPatch.event, revComments);
            if (revTree) {
              for (const child of revTree.children) {
                nodes.push({
                  type: "thread",
                  node: child,
                  ts: child.event.created_at,
                });
              }
            }
          }
        }
      });
    } else if (itemType === "pr") {
      // Initial push node: the PR event itself (like GitHub's "opened this PR")
      if (pr) {
        const sortedUpdates = prUpdates
          ? [...prUpdates].sort(
              (a, b) => a.event.created_at - b.event.created_at,
            )
          : [];
        // The initial push is superseded if any PR Update exists
        const initialSuperseded = sortedUpdates.length > 0;
        nodes.push({
          type: "pr-open",
          pr,
          superseded: initialSuperseded,
          commits: prCommits.map((c) => ({
            hash: c.hash,
            subject: c.message.split("\n")[0],
          })),
          ts: pr.event.created_at,
        });

        sortedUpdates.forEach((update, idx) => {
          // A PR Update is superseded only if a later update changes the tip
          // to a *different* commit (not just adds on top).
          // Simple heuristic: superseded if it's not the last update.
          const superseded = idx < sortedUpdates.length - 1;
          nodes.push({
            type: "pr-update",
            update,
            superseded,
            ts: update.event.created_at,
          });
        });
      }
    }

    // Top-level thread comments (rooted at the original PR/patch)
    if (threadTree) {
      for (const child of threadTree.children) {
        nodes.push({ type: "thread", node: child, ts: child.event.created_at });
      }
    }

    // Subject renames
    for (const item of renameItems) {
      nodes.push({ type: "rename", item, ts: item.event.created_at });
    }

    // Sort everything chronologically
    nodes.sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      // Stable tie-break: push events before comments at same timestamp
      const typeOrder = (t: TimelineNode["type"]) =>
        t === "patch-push" || t === "pr-open" || t === "pr-update" ? 0 : 1;
      return typeOrder(a.type) - typeOrder(b.type);
    });

    return nodes;
  }, [
    itemType,
    patchChain.allRevisions,
    pr,
    prCommits,
    prUpdates,
    threadTree,
    renameItems,
    comments,
    prEvent,
  ]);

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

      {/* Files Changed tab — for PRs (kind 1618) and patches with commit IDs */}
      {(itemType === "pr" ||
        (itemType === "patch" && patchTipCommitId && patchMergeBase)) && (
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

      {/* Commits tab — for PRs with a tip commit, and for patches */}
      {(itemType === "pr" && effectiveTipCommitId) ||
      (itemType === "patch" && patchChain.chain.length > 0) ? (
        <TabsTrigger
          value="commits"
          className="gap-1.5 text-sm rounded-none px-3 pb-2 pt-1 h-auto border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent text-muted-foreground hover:text-foreground transition-colors"
        >
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          Commits
          {itemType === "pr"
            ? prCommits.length > 0 && (
                <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs font-medium leading-none">
                  {prCommits.length}
                </span>
              )
            : patchChain.chain.length > 0 && (
                <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs font-medium leading-none">
                  {patchChain.chain.length}
                </span>
              )}
        </TabsTrigger>
      ) : null}

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
              {/* PR / patch body */}
              {prEvent ? (
                <EventBodyCard event={prEvent} content={body} />
              ) : (
                <EventBodyCardSkeleton />
              )}

              {/* Interleaved timeline: push events + comments + renames */}
              <div className="space-y-1">
                <Separator />

                {!comments ? (
                  <div className="space-y-3 pt-3">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <CommentSkeleton key={i} />
                    ))}
                  </div>
                ) : conversationTimeline.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground/60 text-sm">
                    No activity yet. The conversation awaits its first voice.
                  </div>
                ) : (
                  <div
                    className="min-w-0 border-l pl-1 space-y-0.5"
                    style={{ borderLeftColor: "rgb(59 130 246 / 0.5)" }}
                  >
                    {conversationTimeline.map((node, idx) => {
                      if (node.type === "patch-push") {
                        return (
                          <PatchSetPushEvent
                            key={`patch-push-${node.revision.rootPatch.id}`}
                            revision={node.revision}
                            superseded={node.superseded}
                          />
                        );
                      }
                      if (node.type === "pr-open") {
                        return (
                          <PROpenPushEvent
                            key={`pr-open-${node.pr.id}`}
                            pr={node.pr}
                            superseded={node.superseded}
                            commits={node.commits}
                          />
                        );
                      }
                      if (node.type === "pr-update") {
                        return (
                          <PRUpdatePushEvent
                            key={`pr-update-${node.update.id}`}
                            update={node.update}
                            superseded={node.superseded}
                          />
                        );
                      }
                      if (node.type === "rename") {
                        return (
                          <SubjectRenameCard
                            key={node.item.event.id}
                            event={node.item.event}
                            oldSubject={node.item.oldSubject}
                            newSubject={node.item.newSubject}
                          />
                        );
                      }
                      // thread node
                      return (
                        <ThreadTree
                          key={`thread-${node.node.event.id}-${idx}`}
                          node={node.node}
                          threadContext={
                            activeAccount && prEvent
                              ? {
                                  rootEvent: prEvent,
                                  repoRelays: repo?.relays ?? [],
                                }
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Reply box — only for logged-in users */}
              {activeAccount && prEvent && (
                <ReplyBox rootEvent={prEvent} repoRelays={repo?.relays ?? []} />
              )}
            </TabsContent>

            {/* Files Changed tab — PRs and patches with commit IDs */}
            {(itemType === "pr" ||
              (itemType === "patch" && patchTipCommitId && patchMergeBase)) && (
              <TabsContent value="files" className="mt-0 min-w-0">
                {itemType === "pr" ? (
                  // PR: use effectiveTipCommitId + effectiveMergeBase
                  !effectiveTipCommitId ? (
                    <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                      {prEvent
                        ? "This PR does not include a tip commit ID."
                        : "Loading PR data…"}
                    </div>
                  ) : !effectiveMergeBase ? (
                    <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                      {computingMergeBase
                        ? "Determining base commit…"
                        : "Could not determine the base commit for this PR."}
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
                  )
                ) : // Patch: use patchTipCommitId + patchMergeBase
                !patchTipCommitId ? (
                  <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                    {patchChain.loading
                      ? "Loading patch chain…"
                      : "Patch does not include commit IDs."}
                  </div>
                ) : !patchMergeBase ? (
                  <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                    {computingPatchMergeBase
                      ? "Determining base commit…"
                      : "Could not determine the base commit for this patch set."}
                  </div>
                ) : !gitPool ? (
                  <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                    Connecting to git server…
                  </div>
                ) : (
                  <PRFilesTab
                    tipCommitId={patchTipCommitId}
                    baseCommitId={patchMergeBase}
                    pool={gitPool}
                    fallbackUrls={patchCloneUrls}
                  />
                )}
              </TabsContent>
            )}

            {/* Commits tab — PRs and patches */}
            {(itemType === "pr" && effectiveTipCommitId) ||
            (itemType === "patch" && patchChain.chain.length > 0) ? (
              <TabsContent value="commits" className="mt-0">
                {itemType === "pr" ? (
                  // PR: git-based commit history
                  !effectiveMergeBase ? (
                    <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
                      {computingMergeBase
                        ? "Determining base commit…"
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
                        repoToPath(pubkey, repoId, repo?.relays ?? [])
                      }
                    />
                  )
                ) : // Patch: show commits derived from the patch chain
                patchChain.loading ? (
                  <CommitListLoading count={2} />
                ) : patchChain.chain.length === 0 ? (
                  <CommitListEmpty message="No patches found in this patch set." />
                ) : (
                  <PatchCommitList
                    patches={patchChain.chain}
                    basePath={
                      prBasePath ??
                      repoToPath(pubkey, repoId, repo?.relays ?? [])
                    }
                  />
                )}
              </TabsContent>
            ) : null}

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
