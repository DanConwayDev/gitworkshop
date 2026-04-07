/**
 * Shared components used in both IssuePage and PRPage thread views.
 */
import { lazy, Suspense, useState, type RefObject } from "react";
import { formatDistanceToNow, format } from "date-fns";
import type { NostrEvent } from "nostr-tools";
import { Link } from "react-router-dom";
import { UserLink } from "@/components/UserAvatar";
import { useUnreadHighlight } from "@/hooks/useUnreadHighlight";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar,
  Clock,
  History,
  Mail,
  Pencil,
  Pin,
  RotateCcw,
  ShieldAlert,
  Tag,
} from "lucide-react";
import { EventCardActions } from "@/components/EventCardActions";
import { CommentContent } from "@/components/CommentContent";
import { ThreadTree } from "@/components/ThreadTree";
import type { ThreadTreeNode } from "@/lib/threadTree";
import { cn } from "@/lib/utils";
import { OutboxStatusBadge } from "@/components/OutboxStatusStrip";
import { StatusBadge, StatusIcon } from "@/components/StatusBadge";
import { LabelBadge } from "@/components/LabelBadge";
import type { IssueStatus } from "@/lib/nip34";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MarkdownContent = lazy(() => import("@/components/MarkdownContent"));

// ---------------------------------------------------------------------------
// EventBodyCard — the main body card for an issue or PR/patch
// ---------------------------------------------------------------------------

interface CommitEntry {
  hash: string;
  subject: string;
  href?: string;
  /** When true, `hash` is a Nostr event ID fallback, not a real git commit hash. */
  noCommitId?: boolean;
}

interface EventBodyCardProps {
  event: NostrEvent;
  /** Pre-extracted body text (e.g. from extractBody for patches). Defaults to event.content. */
  content?: string;
  /** Optional list of commits to display below the body (for PRs). */
  commits?: CommitEntry[];
  /**
   * When true, the commits section is dimmed and labelled "outdated" to
   * indicate that a later revision has replaced this patch set.
   */
  commitsSuperseded?: boolean;
  /**
   * When commitsSuperseded is true, this href is used to link the "outdated"
   * badge to the latest commits (e.g. the PR's commits tab).
   */
  commitsLatestHref?: string;
  /**
   * When true, shows a "cover letter" badge indicating the description was
   * sourced from a [PATCH 0/N] cover-letter patch.
   */
  hasCoverLetter?: boolean;
}

export function EventBodyCard({
  event,
  content,
  commits,
  commitsSuperseded,
  commitsLatestHref,
  hasCoverLetter,
}: EventBodyCardProps) {
  const body = content ?? event.content;
  const createdAt = new Date(event.created_at * 1000);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <UserLink
              pubkey={event.pubkey}
              avatarSize="md"
              nameClassName="text-sm"
            />
            <span className="inline-flex items-center gap-1.5 flex-wrap">
              <p className="text-xs text-muted-foreground">
                {format(createdAt, "MMM d, yyyy 'at' h:mm a")}
              </p>
              <OutboxStatusBadge event={event} />
              {hasCoverLetter && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground font-medium">
                  <Mail className="h-2.5 w-2.5" />
                  cover letter
                </span>
              )}
            </span>
          </div>
          <EventCardActions event={event} />
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {body ? (
          <Suspense
            fallback={<div className="h-16 animate-pulse bg-muted rounded" />}
          >
            <MarkdownContent content={body} />
          </Suspense>
        ) : (
          <span className="text-muted-foreground italic text-sm">
            No description provided.
          </span>
        )}

        {commits && commits.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {commits.length} commit{commits.length !== 1 ? "s" : ""}
              </p>
              {commitsSuperseded && (
                <>
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600/80 dark:text-amber-400/80 font-medium">
                    <RotateCcw className="h-2.5 w-2.5" />
                    outdated
                  </span>
                  {commitsLatestHref && (
                    <Link
                      to={commitsLatestHref}
                      className="text-[11px] text-amber-600/70 dark:text-amber-400/70 hover:text-amber-600 dark:hover:text-amber-400 underline underline-offset-2"
                    >
                      view latest
                    </Link>
                  )}
                </>
              )}
            </div>
            <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 divide-y divide-border/30">
              {commits.map((c) => {
                const inner = (
                  <>
                    <span
                      className={cn(
                        "text-[11px] shrink-0",
                        c.noCommitId ? "" : "font-mono",
                        commitsSuperseded
                          ? "line-through text-muted-foreground/50"
                          : c.noCommitId
                            ? "text-muted-foreground/50 italic"
                            : "text-muted-foreground/70",
                      )}
                    >
                      {c.noCommitId ? "[unknown]" : c.hash.slice(0, 7)}
                    </span>
                    <span
                      className={cn(
                        "text-sm truncate",
                        commitsSuperseded
                          ? "line-through text-foreground/40"
                          : "text-foreground/80",
                      )}
                    >
                      {c.subject}
                    </span>
                  </>
                );
                return c.href ? (
                  <Link
                    key={c.hash}
                    to={c.href}
                    className="flex items-center gap-2 py-0.5 min-w-0 rounded px-1 -mx-1 transition-colors hover:bg-muted/40"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div
                    key={c.hash}
                    className="flex items-center gap-2 py-0.5 min-w-0 rounded px-1 -mx-1"
                  >
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EventBodyCardSkeleton() {
  return (
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
  );
}

// ---------------------------------------------------------------------------
// CommentCard
// ---------------------------------------------------------------------------

export function CommentCard({ comment }: { comment: NostrEvent }) {
  const timeAgo = formatDistanceToNow(new Date(comment.created_at * 1000), {
    addSuffix: true,
  });

  // Permalink anchor: first 15 chars of the event ID, matching gitworkshop's convention.
  const anchorId = comment.id.slice(0, 15);
  const { ref, highlight: effectiveHighlight } = useUnreadHighlight(anchorId);
  const cardRef = ref as RefObject<HTMLDivElement>;

  return (
    <Card
      id={anchorId}
      ref={cardRef}
      className={`overflow-hidden transition-all duration-700 hover:shadow-sm scroll-mt-20 ${
        effectiveHighlight === "strong"
          ? "ring-2 ring-pink-500/60 border-pink-500/40 shadow-lg shadow-pink-500/15"
          : effectiveHighlight === "subtle"
            ? "ring-1 ring-pink-500/25 border-pink-500/20"
            : ""
      }`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <UserLink
                  pubkey={comment.pubkey}
                  avatarSize="md"
                  nameClassName="text-sm"
                />
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {timeAgo}
                  </span>
                  <OutboxStatusBadge event={comment} />
                </span>
              </div>
              <EventCardActions event={comment} />
            </div>
            <CommentContent content={comment.content} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CommentSkeleton() {
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

// ---------------------------------------------------------------------------
// SubjectRenameCard
// ---------------------------------------------------------------------------

export function SubjectRenameCard({
  event,
  oldSubject,
  newSubject,
}: {
  event: NostrEvent;
  oldSubject: string;
  newSubject: string;
}) {
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });

  return (
    <div className="relative flex gap-3 py-1.5 pl-1">
      <div className="relative flex items-start pt-0.5">
        <div className="flex items-center justify-center h-8 w-8 rounded-full border bg-muted/40 shrink-0">
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      <div className="flex-1 min-w-0 pt-1">
        <p className="text-sm text-muted-foreground">
          <UserLink
            pubkey={event.pubkey}
            avatarSize="sm"
            nameClassName="text-sm font-medium text-foreground"
          />{" "}
          changed the title{" "}
          <span className="text-xs text-muted-foreground/60 inline-flex items-center gap-1 align-middle">
            <Clock className="h-3 w-3" />
            {timeAgo}
          </span>
        </p>

        <p className="mt-1.5 text-sm leading-relaxed break-words">
          <span className="line-through text-muted-foreground/60 decoration-muted-foreground/30">
            {oldSubject || "(untitled)"}
          </span>
          <span className="mx-1.5 text-muted-foreground/40 select-none">→</span>
          <span className="font-medium text-foreground">{newSubject}</span>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusChangeCard
// ---------------------------------------------------------------------------

export function StatusChangeCard({
  event,
  status,
  authorised,
  variant = "issue",
}: {
  event: NostrEvent;
  status: IssueStatus;
  /** True when the author is a maintainer or the item author. */
  authorised: boolean;
  variant?: "issue" | "pr";
}) {
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });

  return (
    <div className="relative flex gap-3 py-1.5 pl-1">
      <div className="flex items-start pt-0.5">
        <div className="flex items-center justify-center h-8 w-8 rounded-full border bg-muted/40 shrink-0">
          {authorised ? (
            <StatusIcon status={status} variant={variant} />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 pt-1">
        <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
          <UserLink
            pubkey={event.pubkey}
            avatarSize="sm"
            nameClassName="text-sm font-medium text-foreground"
          />
          <span>{authorised ? "set status to" : "proposed status"}</span>
          <StatusBadge status={status} variant={variant} />
          <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo}
          </span>
        </p>
        {!authorised && (
          <p className="mt-0.5 text-xs text-muted-foreground/50">
            User is not a maintainer — status change not applied
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LabelChangeCard
// ---------------------------------------------------------------------------

export function LabelChangeCard({
  event,
  labels,
  authorised,
}: {
  event: NostrEvent;
  labels: string[];
  /** True when the author is a maintainer or the item author. */
  authorised: boolean;
}) {
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });

  return (
    <div className="relative flex gap-3 py-1.5 pl-1">
      <div className="flex items-start pt-0.5">
        <div className="flex items-center justify-center h-8 w-8 rounded-full border bg-muted/40 shrink-0">
          {authorised ? (
            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 pt-1">
        <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
          <UserLink
            pubkey={event.pubkey}
            avatarSize="sm"
            nameClassName="text-sm font-medium text-foreground"
          />
          <span>
            {authorised ? "added" : "proposed"} label
            {labels.length !== 1 ? "s" : ""}
          </span>
          {labels.map((label) => (
            <LabelBadge key={label} label={label} />
          ))}
          <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo}
          </span>
        </div>
        {!authorised && (
          <p className="mt-0.5 text-xs text-muted-foreground/50">
            User is not a maintainer — label change not applied
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThreadedComments — interleaves a thread tree with subject-rename events
// ---------------------------------------------------------------------------

export interface RenameItem {
  event: NostrEvent;
  newSubject: string;
  oldSubject: string;
}

export interface ThreadContext {
  rootEvent: NostrEvent;
  /** Repo coordinate strings (e.g. "30617:<pubkey>:<d>") for relay group keying */
  repoCoords?: string[];
}

// ---------------------------------------------------------------------------
// CoverNoteCard — pinned note from the item author or a maintainer
// ---------------------------------------------------------------------------

/**
 * Displays the latest authorised cover note (kind:1624) for an issue or PR,
 * with a versions history dropdown and a raw JSON viewer.
 *
 * Shown above the first description card, below the page title. Mirrors
 * gitworkshop's CoverNote component.
 *
 * @param events - All authorised cover notes, sorted newest-first. The first
 *                 entry is the one displayed by default.
 */
export function CoverNoteCard({ events }: { events: NostrEvent[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [jsonOpen, setJsonOpen] = useState(false);

  const event = events[selectedIndex];
  if (!event) return null;

  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });

  const hasMultiple = events.length > 1;

  return (
    <>
      <div className="border-l-4 border-blue-500/60 bg-muted/30 rounded-r-md px-4 py-3 mb-4">
        <div className="flex items-start gap-2">
          {/* Left: metadata + content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mb-2">
              <Pin className="h-3.5 w-3.5 shrink-0 text-blue-500/70" />
              <span className="font-medium uppercase tracking-wide text-blue-500/80">
                Cover note
              </span>
              {hasMultiple && selectedIndex > 0 && (
                <span className="text-xs text-amber-500/80 font-medium">
                  (older version)
                </span>
              )}
              <span className="text-muted-foreground/40">by</span>
              <UserLink
                pubkey={event.pubkey}
                avatarSize="sm"
                nameClassName="text-xs font-medium text-foreground"
              />
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {timeAgo}
              </span>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
              <Suspense
                fallback={
                  <div className="h-8 animate-pulse bg-muted rounded" />
                }
              >
                <MarkdownContent content={event.content} />
              </Suspense>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {/* Raw JSON viewer */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground/60 hover:text-foreground"
              title="View raw event JSON"
              onClick={() => setJsonOpen(true)}
            >
              <span className="text-[10px] font-mono font-bold leading-none">
                {"{}"}
              </span>
            </Button>

            {/* Versions dropdown — only shown when there are multiple */}
            {hasMultiple && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground/60 hover:text-foreground"
                    title={`${events.length} versions — click to browse`}
                  >
                    <History className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {events.map((ev, idx) => (
                    <DropdownMenuItem
                      key={ev.id}
                      onClick={() => setSelectedIndex(idx)}
                      className={cn(
                        "flex flex-col items-start gap-0.5 cursor-pointer",
                        idx === selectedIndex && "bg-accent",
                      )}
                    >
                      <div className="flex items-center gap-1.5 w-full">
                        {idx === 0 && (
                          <span className="text-[10px] font-medium text-blue-500/80 uppercase tracking-wide">
                            Latest
                          </span>
                        )}
                        {idx > 0 && (
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            v{events.length - idx}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatDistanceToNow(new Date(ev.created_at * 1000), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground/70 truncate w-full">
                        by{" "}
                        <span className="font-mono text-[10px]">
                          {ev.pubkey.slice(0, 8)}…
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {/* Raw JSON modal */}
      <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              Raw event · kind:{event.kind}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <pre className="text-xs font-mono bg-muted rounded-md p-4 whitespace-pre-wrap break-all">
              {JSON.stringify(event, null, 2)}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Renders the comment thread tree with subject-rename events interleaved
 * chronologically among the top-level children.
 *
 * Renames are not part of the reply tree — they're timeline markers that
 * appear between top-level thread nodes based on their created_at timestamp.
 */
export function ThreadedComments({
  tree,
  renameItems,
  threadContext,
}: {
  tree: { children: ThreadTreeNode[]; event: NostrEvent };
  renameItems: RenameItem[];
  threadContext?: ThreadContext;
}) {
  type TimelineItem =
    | { type: "thread"; node: ThreadTreeNode }
    | { type: "rename"; item: RenameItem };

  const items: TimelineItem[] = [];

  for (const child of tree.children) {
    items.push({ type: "thread", node: child });
  }
  for (const rename of renameItems) {
    items.push({ type: "rename", item: rename });
  }

  items.sort((a, b) => {
    const aTime =
      a.type === "thread" ? a.node.event.created_at : a.item.event.created_at;
    const bTime =
      b.type === "thread" ? b.node.event.created_at : b.item.event.created_at;
    if (aTime !== bTime) return aTime - bTime;
    const aId = a.type === "thread" ? a.node.event.id : a.item.event.id;
    const bId = b.type === "thread" ? b.node.event.id : b.item.event.id;
    return aId.localeCompare(bId);
  });

  return (
    <div
      className="min-w-0 border-l pl-1"
      style={{ borderLeftColor: "rgb(59 130 246 / 0.5)" }}
    >
      {items.map((item) =>
        item.type === "thread" ? (
          <ThreadTree
            key={item.node.event.id}
            node={item.node}
            threadContext={threadContext}
          />
        ) : (
          <SubjectRenameCard
            key={item.item.event.id}
            event={item.item.event}
            oldSubject={item.item.oldSubject}
            newSubject={item.item.newSubject}
          />
        ),
      )}
    </div>
  );
}
