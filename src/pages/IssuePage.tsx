import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  useIssueComments,
  useIssueLabels,
  useIssueStatus,
  useIssueZaps,
  useIssueSubjectRenames,
  useIssueMaintainers,
  resolveCurrentSubject,
} from "@/hooks/useIssues";
import { useNip34Loaders } from "@/hooks/useNip34Loaders";
import { useRepoContext } from "@/pages/repo/RepoContext";
import { UserAvatar, UserLink } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { LabelBadge } from "@/components/LabelBadge";
import { ChangeStatusDropdown } from "@/components/ChangeStatusDropdown";
import {
  NostrComposer,
  composerHasNsec,
  hasPreviewableContent,
} from "@/components/NostrComposer";
import { extractContentTags } from "@/lib/nostrContentTags";
import { usePublish } from "@/hooks/usePublish";
import { useToast } from "@/hooks/useToast";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  MessageCircle,
  Zap,
  Users,
  Clock,
  Loader2,
  MessageSquarePlus,
} from "lucide-react";
import { Issue } from "@/casts/Issue";
import { ISSUE_KIND, COMMENT_KIND } from "@/lib/nip34";
import { gitIndexRelays, relayCurationMode } from "@/services/settings";
import { pool } from "@/services/nostr";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { castTimelineStream } from "applesauce-common/observable";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";

export default function IssuePage() {
  const { pubkey, repoId, resolved, issueId } = useRepoContext();
  const repo = resolved?.repo;
  const repoRelayGroup = resolved?.repoRelayGroup;
  const extraRelaysForMaintainerMailboxCoverage =
    resolved?.extraRelaysForMaintainerMailboxCoverage;

  // Respect the user's relay curation preference.
  const curationMode = use$(relayCurationMode);

  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  // Fetch the issue event via the repo relay group when available;
  // fall back to gitIndexRelays for initial discovery before the group is ready.
  use$(() => {
    if (!issueId) return undefined;
    const issueFilters: Filter[] = [{ kinds: [ISSUE_KIND], ids: [issueId] }];
    if (repoRelayGroup) {
      return repoRelayGroup
        .subscription(issueFilters)
        .pipe(onlyEvents(), mapEventsToStore(store));
    }
    return pool
      .subscription(gitIndexRelays.getValue(), issueFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [issueId, repoRelayGroup, store]);

  // In outbox mode, also fetch the issue from the extra maintainer mailbox
  // relays in case it was published only there.
  use$(() => {
    if (
      !issueId ||
      curationMode !== "outbox" ||
      !extraRelaysForMaintainerMailboxCoverage
    )
      return undefined;
    const issueFilters: Filter[] = [{ kinds: [ISSUE_KIND], ids: [issueId] }];
    return extraRelaysForMaintainerMailboxCoverage
      .subscription(issueFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [issueId, curationMode, extraRelaysForMaintainerMailboxCoverage, store]);

  // Subscribe to store, cast to Issue
  const issues = use$(() => {
    if (!issueId) return undefined;
    const issueFilters: Filter[] = [{ kinds: [ISSUE_KIND], ids: [issueId] }];
    return store
      .timeline(issueFilters)
      .pipe(castTimelineStream(Issue, castStore)) as unknown as Observable<
      Issue[]
    >;
  }, [issueId, store]);

  const issue = issues?.[0];

  // Trigger two-tier loading for this issue via the repo relay group.
  // In outbox mode, also enable author NIP-65 inbox fetching for maximum
  // completeness — the loader handles the delta internally.
  useNip34Loaders(issueId, repoRelayGroup, {
    includeAuthorNip65: curationMode === "outbox",
  });

  // Compute the effective maintainer set for this issue.
  // On IssuePage we always have the selected maintainer from the URL, so pass
  // the resolved maintainerSet directly (or undefined while it's loading).
  const selectedMaintainers = useMemo(
    () => (repo?.maintainerSet ? new Set(repo.maintainerSet) : undefined),
    [repo?.maintainerSet],
  );
  // useIssueMaintainers is called here to satisfy the rules of hooks even
  // though we pass selectedMaintainers directly — it short-circuits internally.
  useIssueMaintainers(issueId, selectedMaintainers);

  const issuePubkey = issue?.pubkey;
  const status = useIssueStatus(issueId, issuePubkey, selectedMaintainers);
  const nip32Labels = useIssueLabels(issueId, issuePubkey, selectedMaintainers);
  const comments = useIssueComments(issueId);
  const zaps = useIssueZaps(issueId);
  const subjectRenames = useIssueSubjectRenames(
    issueId,
    issuePubkey,
    selectedMaintainers,
  );

  // Resolve the current (effective) subject from pre-filtered rename events.
  const currentSubject = resolveCurrentSubject(
    issue?.subject ?? "",
    subjectRenames,
  );

  // Authorisation: can the logged-in user edit the subject / status?
  const activeAccount = useActiveAccount();
  const canEdit = useMemo(() => {
    if (!activeAccount || !issue) return false;
    const pk = activeAccount.pubkey;
    if (pk === issue.pubkey) return true;
    return selectedMaintainers?.has(pk) ?? false;
  }, [activeAccount, issue, selectedMaintainers]);
  const canEditSubject = canEdit;

  // Merge labels from the issue's own t-tags with any NIP-32 label events.
  // Deduplicated and sorted for stable rendering.
  const allLabels = useMemo(() => {
    const merged = new Set([...(issue?.labels ?? []), ...nip32Labels]);
    return Array.from(merged).sort();
  }, [issue?.labels, nip32Labels]);

  // Participants: issue author + comment authors
  const participants = useMemo(() => {
    const pubkeys = new Set<string>();
    if (issue) pubkeys.add(issue.pubkey);
    if (comments) {
      for (const c of comments) pubkeys.add(c.pubkey);
    }
    return Array.from(pubkeys);
  }, [issue, comments]);

  // Build the thread tree from the issue event + comments.
  // Subject renames are interleaved at the top level chronologically.
  const threadTree = useMemo(() => {
    if (!issue || !comments) return undefined;
    return getThreadTree(issue.event, comments);
  }, [issue, comments]);

  // Compute subject rename items with old/new subjects for display.
  const renameItems = useMemo(() => {
    if (!subjectRenames || subjectRenames.length === 0) return [];
    let prevSubject = issue?.subject ?? "";
    return subjectRenames.map((ev) => {
      const newSubject =
        ev.tags.find(([t, , ns]) => t === "l" && ns === "#subject")?.[1] ??
        prevSubject;
      const item = { event: ev, newSubject, oldSubject: prevSubject };
      prevSubject = newSubject;
      return item;
    });
  }, [subjectRenames, issue?.subject]);

  useSeoMeta({
    title: issue ? `${currentSubject || issue.subject} - ngit` : "Issue - ngit",
    description: issue?.content.slice(0, 160) ?? "Loading issue...",
  });

  return (
    <>
      {/* Issue header */}
      <div className="border-b border-border/40">
        <div className="container max-w-screen-xl px-4 md:px-8 py-6">
          {issue ? (
            <div>
              <div className="flex items-start gap-3 mb-3">
                <StatusBadge status={status} className="mt-1" />
                <EditableSubject
                  issueId={issue.id}
                  currentSubject={currentSubject || issue.subject}
                  canEdit={canEditSubject}
                  repoRelays={repo?.relays}
                />
              </div>

              <div className="flex items-center gap-4 flex-wrap text-sm text-muted-foreground ml-[calc(theme(spacing.3)+4.5rem-3.5rem)]">
                <UserLink
                  pubkey={issue.pubkey}
                  avatarSize="sm"
                  nameClassName="text-sm"
                />
                <div className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  <span>
                    {formatDistanceToNow(issue.createdAt, { addSuffix: true })}
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
          <div className="min-w-0 space-y-4">
            {/* Issue body */}
            {issue ? (
              <EventBodyCard event={issue.event} />
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
                <ThreadedComments tree={threadTree} renameItems={renameItems} />
              ) : null}
            </div>

            {/* Reply box — only for logged-in users */}
            {activeAccount && issue && (
              <ReplyBox
                issueId={issue.id}
                issuePubkey={issue.pubkey}
                repoRelays={repo?.relays ?? []}
              />
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Stats card */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <StatusBadge status={status} />
                </div>

                {canEdit && issue && status !== "deleted" && (
                  <ChangeStatusDropdown
                    itemId={issue.id}
                    itemAuthorPubkey={issue.pubkey}
                    repoCoords={issue.repoCoords}
                    currentStatus={status}
                    options={[
                      { value: "open", label: "Open" },
                      { value: "resolved", label: "Resolved" },
                      { value: "closed", label: "Closed" },
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
              to={`${repoToPath(pubkey, repoId, repo?.relays ?? [])}/issues`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to issues
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// ReplyBox — NIP-22 comment composer for the issue page
// ---------------------------------------------------------------------------

interface ReplyBoxProps {
  issueId: string;
  issuePubkey: string;
  repoRelays: string[];
}

function ReplyBox({ issueId, issuePubkey, repoRelays }: ReplyBoxProps) {
  const [body, setBody] = useState("");
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const [focused, setFocused] = useState(false);
  const { publishEvent, isPending } = usePublish();
  const { toast } = useToast();

  const showToggle = focused || hasPreviewableContent(body);

  const relayHint = repoRelays[0] ?? "";

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const trimmed = body.trim();
      if (!trimmed) return;

      try {
        await publishEvent({
          kind: COMMENT_KIND,
          content: trimmed,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            // NIP-22: uppercase = root of thread
            ["E", issueId, relayHint, "root"],
            ["P", issuePubkey],
            // lowercase = immediate reply parent (same as root for top-level comments)
            ["e", issueId, relayHint, "reply"],
            ["p", issuePubkey],
            // kind of the root event
            ["k", String(ISSUE_KIND)],
            // p/q tags for any NIP-19 references in the comment body
            ...extractContentTags(trimmed),
          ],
        });

        toast({
          title: "Comment posted",
          description: "Your comment has been published.",
        });

        setBody("");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to post comment";
        toast({
          title: "Failed to post comment",
          description: message,
          variant: "destructive",
        });
      }
    },
    [body, issueId, issuePubkey, relayHint, publishEvent, toast],
  );

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
            <span>Add a comment</span>
          </div>

          <NostrComposer
            value={body}
            onChange={setBody}
            placeholder="Leave a comment."
            disabled={isPending}
            rows={4}
            minRows={4}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onFocusChange={setFocused}
          />

          <div className="flex items-center justify-between">
            <div
              className={`flex items-center gap-1 transition-opacity duration-200 ${showToggle ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              {(["write", "preview"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !body.trim() || composerHasNsec(body)}
              className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Posting...
                </>
              ) : (
                "Comment"
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
