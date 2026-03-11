import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { nip19 } from "nostr-tools";
import { formatDistanceToNow, format } from "date-fns";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import {
  useIssueComments,
  useIssueStatus,
  useIssueZaps,
} from "@/hooks/useIssues";
import { useRepository } from "@/hooks/useRepositories";
import { UserAvatar, UserName, UserLink } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { LabelBadge } from "@/components/LabelBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  GitBranch,
  MessageCircle,
  Zap,
  Users,
  Clock,
  Calendar,
} from "lucide-react";
import { Issue } from "@/casts/Issue";
import { ISSUE_KIND, NGIT_RELAYS } from "@/lib/nip34";
import { pool } from "@/services/nostr";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { castTimelineStream } from "applesauce-common/observable";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

export default function IssuePage() {
  const { npub, repoId, issueId } = useParams<{
    npub: string;
    repoId: string;
    issueId: string;
  }>();

  // Decode npub
  const pubkey = useMemo(() => {
    if (!npub) return undefined;
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === "npub") return decoded.data;
      return undefined;
    } catch {
      return undefined;
    }
  }, [npub]);

  const repo = useRepository(pubkey, repoId);
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  const issueFilterKey = JSON.stringify(issueId);

  // Fetch from relay
  use$(() => {
    if (!issueId) return undefined;
    const issueFilters: Filter[] = [{ kinds: [ISSUE_KIND], ids: [issueId] }];
    return pool
      .req(NGIT_RELAYS, issueFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [issueFilterKey, store]);

  // Subscribe to store, cast to Issue
  const issues = use$(() => {
    if (!issueId) return undefined;
    const issueFilters: Filter[] = [{ kinds: [ISSUE_KIND], ids: [issueId] }];
    return store
      .timeline(issueFilters)
      .pipe(castTimelineStream(Issue, castStore)) as unknown as Observable<
      Issue[]
    >;
  }, [issueFilterKey, store]);

  const issue = issues?.[0];

  const status = useIssueStatus(issueId);
  const comments = useIssueComments(issueId);
  const zaps = useIssueZaps(issueId);

  // Participants
  const participants = useMemo(() => {
    const pubkeys = new Set<string>();
    if (issue) pubkeys.add(issue.pubkey);
    if (comments) {
      for (const c of comments) pubkeys.add(c.pubkey);
    }
    return Array.from(pubkeys);
  }, [issue, comments]);

  useSeoMeta({
    title: issue ? `${issue.subject} - ngit` : "Issue - ngit",
    description: issue?.content.slice(0, 160) ?? "Loading issue...",
  });

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="relative isolate border-b border-border/40">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-500/5 via-transparent to-fuchsia-500/5" />

        <div className="container max-w-screen-xl px-4 md:px-8 py-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground transition-colors">
              Repositories
            </Link>
            <span>/</span>
            {repo ? (
              <Link
                to={`/${npub}/${repoId}`}
                className="hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <GitBranch className="h-3.5 w-3.5" />
                {repo.name}
              </Link>
            ) : (
              <Skeleton className="h-4 w-24 inline-block" />
            )}
            <span>/</span>
            <span className="text-foreground">Issue</span>
          </div>

          {issue ? (
            <div>
              <div className="flex items-start gap-3 mb-3">
                <StatusBadge status={status} className="mt-1" />
                <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                  {issue.subject}
                </h1>
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
          <div className="space-y-4">
            {/* Issue body */}
            {issue ? (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <UserLink
                      pubkey={issue.pubkey}
                      avatarSize="md"
                      nameClassName="text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      {format(issue.createdAt, "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap break-words">
                    {issue.content || (
                      <span className="text-muted-foreground italic">
                        No description provided.
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                </CardContent>
              </Card>
            )}

            {/* Comments */}
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
              ) : comments.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground/60 text-sm">
                  No comments yet. The conversation awaits its first voice.
                </div>
              ) : (
                <div className="space-y-3">
                  {comments.map((comment) => (
                    <CommentCard key={comment.id} comment={comment} />
                  ))}
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
                  <StatusBadge status={status} />
                </div>

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
              to={`/${npub}/${repoId}`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to issues
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommentCard({ comment }: { comment: NostrEvent }) {
  const timeAgo = formatDistanceToNow(new Date(comment.created_at * 1000), {
    addSuffix: true,
  });

  return (
    <Card className="transition-all duration-200 hover:shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <UserLink
                pubkey={comment.pubkey}
                avatarSize="md"
                nameClassName="text-sm"
              />
              <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {timeAgo}
              </span>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap break-words text-sm">
              {comment.content}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CommentSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
