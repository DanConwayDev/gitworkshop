import { useMemo } from "react";
import { Link } from "react-router-dom";
import { repoToPath } from "@/lib/routeUtils";
import { useSeoMeta } from "@unhead/react";
import { useActiveAccount } from "applesauce-react/hooks";
import { formatDistanceToNow } from "date-fns";
import { EditableSubject } from "@/components/EditSubjectInline";
import {
  EventBodyCard,
  EventBodyCardSkeleton,
  CommentCard,
  CommentSkeleton,
  SubjectRenameCard,
} from "@/components/EventThreadComponents";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import {
  usePRComments,
  usePRLabels,
  usePRStatus,
  usePRZaps,
  usePRSubjectRenames,
  usePRMaintainers,
  resolveCurrentPRSubject,
} from "@/hooks/usePRs";
import { useNip34Loaders } from "@/hooks/useNip34Loaders";
import { useRepoContext } from "@/pages/repo/RepoContext";
import { UserAvatar, UserLink } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { LabelBadge } from "@/components/LabelBadge";
import { ChangeStatusDropdown } from "@/components/ChangeStatusDropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  MessageCircle,
  Zap,
  Users,
  Clock,
  GitPullRequest,
  GitCommitHorizontal,
} from "lucide-react";
import {
  PATCH_KIND,
  PATCH_CHAIN_TAGS,
  PR_ROOT_KINDS,
  extractSubject,
  extractBody,
} from "@/lib/nip34";
import { gitIndexRelays, relayCurationMode } from "@/services/settings";
import { pool } from "@/services/nostr";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

export default function PRPage() {
  const { pubkey, repoId, resolved, prId } = useRepoContext();
  const repo = resolved?.repo;
  const repoRelayGroup = resolved?.repoRelayGroup;
  const extraRelaysForMaintainerMailboxCoverage =
    resolved?.extraRelaysForMaintainerMailboxCoverage;

  const curationMode = use$(relayCurationMode);
  const store = useEventStore();

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

  // Subscribe to the raw event from the store.
  const prEvent = use$(() => {
    if (!prId) return undefined;
    return store.event(prId) as unknown as Observable<NostrEvent | undefined>;
  }, [prId, store]);

  // Derive subject and body from the raw event using the extractors.
  const originalSubject = prEvent ? extractSubject(prEvent) : "";
  const body = prEvent ? extractBody(prEvent) : "";
  const itemType = prEvent?.kind === PATCH_KIND ? "patch" : "pr";

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
  // Exclude internal patch-chain tags (root, revision-root, etc.) so they
  // don't appear as user-visible labels.
  const eventLabels = useMemo(() => {
    if (!prEvent) return [];
    return prEvent.tags
      .filter(([t, v]) => t === "t" && !PATCH_CHAIN_TAGS.has(v))
      .map(([, v]) => v);
  }, [prEvent]);

  const allLabels = useMemo(() => {
    const merged = new Set([...eventLabels, ...nip32Labels]);
    return Array.from(merged).sort();
  }, [eventLabels, nip32Labels]);

  // Participants: author + comment authors
  const participants = useMemo(() => {
    const pubkeys = new Set<string>();
    if (prEvent) pubkeys.add(prEvent.pubkey);
    if (comments) {
      for (const c of comments) pubkeys.add(c.pubkey);
    }
    return Array.from(pubkeys);
  }, [prEvent, comments]);

  // Build the merged thread: comments + subject-rename events.
  const threadItems = useMemo(() => {
    type ThreadItem =
      | { type: "comment"; event: NostrEvent }
      | {
          type: "rename";
          event: NostrEvent;
          newSubject: string;
          oldSubject: string;
        };

    const items: ThreadItem[] = [];

    if (comments) {
      for (const c of comments) {
        items.push({ type: "comment", event: c });
      }
    }

    if (subjectRenames) {
      let prevSubject = originalSubject;
      for (const ev of subjectRenames) {
        const newSubject =
          ev.tags.find(([t, , ns]) => t === "l" && ns === "#subject")?.[1] ??
          prevSubject;
        items.push({
          type: "rename",
          event: ev,
          newSubject,
          oldSubject: prevSubject,
        });
        prevSubject = newSubject;
      }
    }

    return items.sort(
      (a, b) =>
        a.event.created_at - b.event.created_at ||
        a.event.id.localeCompare(b.event.id),
    );
  }, [comments, subjectRenames, originalSubject]);

  const TypeIcon = itemType === "patch" ? GitCommitHorizontal : GitPullRequest;

  useSeoMeta({
    title: prEvent
      ? `${currentSubject || originalSubject} - ngit`
      : "PR - ngit",
    description: body?.slice(0, 160) ?? "Loading PR...",
  });

  return (
    <>
      {/* PR header */}
      <div className="border-b border-border/40">
        <div className="container max-w-screen-xl px-4 md:px-8 py-6">
          {prEvent ? (
            <div>
              <div className="flex items-start gap-3 mb-3">
                <StatusBadge status={status} variant="pr" className="mt-1" />
                <EditableSubject
                  issueId={prEvent.id}
                  currentSubject={currentSubject || originalSubject}
                  canEdit={canEditSubject}
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
                    {formatDistanceToNow(new Date(prEvent.created_at * 1000), {
                      addSuffix: true,
                    })}
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
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
          {/* Main content */}
          <div className="space-y-4">
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
              ) : threadItems.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground/60 text-sm">
                  No comments yet. The conversation awaits its first voice.
                </div>
              ) : (
                <div className="space-y-3">
                  {threadItems.map((item) =>
                    item.type === "comment" ? (
                      <CommentCard key={item.event.id} comment={item.event} />
                    ) : (
                      <SubjectRenameCard
                        key={item.event.id}
                        event={item.event}
                        oldSubject={item.oldSubject}
                        newSubject={item.newSubject}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
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
                    repoCoords={prEvent.tags
                      .filter(([t]) => t === "a")
                      .map(([, v]) => v)}
                    currentStatus={status}
                    options={[
                      { value: "open", label: "Open" },
                      { value: "resolved", label: "Merged" },
                      { value: "closed", label: "Closed" },
                      { value: "draft", label: "Draft" },
                    ]}
                    relays={repo?.relays}
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
    </>
  );
}
