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
  CommentSkeleton,
  CoverNoteCard,
  SubjectRenameCard,
  StatusChangeCard,
  LabelChangeCard,
} from "@/components/EventThreadComponents";
import { ThreadTree } from "@/components/ThreadTree";
import { useResolvedIssue } from "@/hooks/useResolvedIssue";
import { useRepoContext } from "@/pages/repo/RepoContext";
import { UserAvatar, UserLink } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { LabelBadge } from "@/components/LabelBadge";
import { ChangeStatusDropdown } from "@/components/ChangeStatusDropdown";
import { ReplyBox } from "@/components/ReplyBox";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, MessageCircle, Zap, Users, Clock } from "lucide-react";

export default function IssuePage() {
  const { pubkey, repoId, resolved, issueId, nip05 } = useRepoContext();
  const repo = resolved?.repo;

  // Compute the effective maintainer set.
  const selectedMaintainers = useMemo(
    () => (repo?.maintainerSet ? new Set(repo.maintainerSet) : undefined),
    [repo?.maintainerSet],
  );

  // ── Unified issue resolution ─────────────────────────────────────────────
  const issue = useResolvedIssue(
    issueId,
    resolved?.repoRelayGroup,
    resolved?.extraRelaysForMaintainerMailboxCoverage,
    selectedMaintainers,
  );

  // ── Auth ──────────────────────────────────────────────────────────────────
  const activeAccount = useActiveAccount();
  const canEdit = useMemo(() => {
    if (!activeAccount || !issue) return false;
    return issue.authorisedUsers.has(activeAccount.pubkey);
  }, [activeAccount, issue]);

  useSeoMeta({
    title: issue
      ? `${issue.currentSubject || issue.originalSubject} - ngit`
      : "Issue - ngit",
    description: issue?.body.slice(0, 160) ?? "Loading issue...",
  });

  return (
    <>
      {/* Issue header */}
      <div className="border-b border-border/40">
        <div className="container max-w-screen-xl px-4 md:px-8 py-6">
          {issue ? (
            <div>
              <div className="flex items-start gap-3 mb-3">
                <StatusBadge status={issue.status} className="mt-1" />
                <EditableSubject
                  issueId={issue.id}
                  currentSubject={issue.currentSubject || issue.originalSubject}
                  canEdit={canEdit}
                  repoCoords={issue.repoCoords}
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
                    {formatDistanceToNow(new Date(issue.createdAt * 1000), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                {issue.labels.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {issue.labels.map((label) => (
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
            {/* Cover note — pinned note from author/maintainer */}
            {issue?.coverNote && <CoverNoteCard event={issue.coverNote} />}

            {/* Issue body */}
            {issue ? (
              <EventBodyCard event={issue.rootEvent} content={issue.body} />
            ) : (
              <EventBodyCardSkeleton />
            )}

            {/* Thread: comments + subject renames */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <MessageCircle className="h-4 w-4" />
                <span>
                  {issue
                    ? `${issue.commentCount} ${issue.commentCount === 1 ? "comment" : "comments"}`
                    : "Loading comments..."}
                </span>
              </div>

              <Separator />

              {!issue ? (
                <div className="space-y-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <CommentSkeleton key={i} />
                  ))}
                </div>
              ) : issue.timelineNodes.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground/60 text-sm">
                  No comments yet. The conversation awaits its first voice.
                </div>
              ) : (
                <div
                  className="min-w-0 border-l pl-1 space-y-0.5"
                  style={{ borderLeftColor: "rgb(59 130 246 / 0.5)" }}
                >
                  {issue.timelineNodes.map((node, idx) => {
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
                          variant="issue"
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
                          activeAccount && issue
                            ? {
                                rootEvent: issue.rootEvent,
                                repoCoords: issue.repoCoords,
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Reply box — always shown; anonymous posting handled inside */}
            {issue && <ReplyBox rootEvent={issue.rootEvent} />}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Stats card */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <StatusBadge status={issue?.status ?? "open"} />
                </div>

                {canEdit && issue && issue.status !== "deleted" && (
                  <ChangeStatusDropdown
                    itemId={issue.id}
                    itemAuthorPubkey={issue.pubkey}
                    repoCoords={issue.repoCoords}
                    currentStatus={issue.status}
                    options={[
                      { value: "open", label: "Open" },
                      { value: "resolved", label: "Resolved" },
                      { value: "closed", label: "Closed" },
                    ]}
                  />
                )}

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <MessageCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Comments</span>
                    <span className="ml-auto font-medium">
                      {issue?.commentCount ?? 0}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <Zap className="h-4 w-4 text-amber-500" />
                    <span className="text-muted-foreground">Zaps</span>
                    <span className="ml-auto font-medium">
                      {issue?.zapCount ?? 0}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Participants</span>
                    <span className="ml-auto font-medium">
                      {issue?.participants.length ?? 0}
                    </span>
                  </div>
                </div>

                <Separator />

                {/* Participant avatars */}
                {issue && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Participants
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {issue.participants.map((pk) => (
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
                {issue && issue.labels.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">
                        Labels
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {issue.labels.map((label) => (
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
              to={`${repoToPath(pubkey, repoId, repo?.relays ?? [], nip05)}/issues`}
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
