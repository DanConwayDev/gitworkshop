/**
 * Shared components used in both IssuePage and PRPage thread views.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import type { NostrEvent } from "nostr-tools";
import { UserLink } from "@/components/UserAvatar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Clock, Pencil } from "lucide-react";
import { EventCardActions } from "@/components/EventCardActions";
import { CommentContent } from "@/components/CommentContent";
import { ThreadTree } from "@/components/ThreadTree";
import type { ThreadTreeNode } from "@/lib/threadTree";

const MarkdownContent = lazy(() => import("@/components/MarkdownContent"));

// ---------------------------------------------------------------------------
// EventBodyCard — the main body card for an issue or PR/patch
// ---------------------------------------------------------------------------

interface EventBodyCardProps {
  event: NostrEvent;
  /** Pre-extracted body text (e.g. from extractBody for patches). Defaults to event.content. */
  content?: string;
}

export function EventBodyCard({ event, content }: EventBodyCardProps) {
  const body = content ?? event.content;
  const createdAt = new Date(event.created_at * 1000);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <UserLink
              pubkey={event.pubkey}
              avatarSize="md"
              nameClassName="text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {format(createdAt, "MMM d, yyyy 'at' h:mm a")}
            </p>
          </div>
          <EventCardActions event={event} />
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
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
  const cardRef = useRef<HTMLDivElement>(null);
  const isTargeted = window.location.hash === `#${anchorId}`;
  // Two-phase highlight: "strong" on arrival → "subtle" persistent indicator.
  // Handles async comment loading pushing the card off-screen before the user
  // has seen it.
  const [highlight, setHighlight] = useState<"strong" | "subtle" | "none">(
    isTargeted ? "strong" : "none",
  );

  useEffect(() => {
    if (!isTargeted || !cardRef.current) return;

    const el = cardRef.current;

    // Once the user intentionally scrolls, stop chasing them back to the
    // target element.
    let userScrolled = false;
    const onUserScroll = () => {
      userScrolled = true;
    };
    window.addEventListener("wheel", onUserScroll, {
      passive: true,
      once: true,
    });
    window.addEventListener("touchmove", onUserScroll, {
      passive: true,
      once: true,
    });
    window.addEventListener("keydown", onUserScroll, {
      passive: true,
      once: true,
    });

    // Scroll to the element immediately after paint.
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Transition to "subtle" only once the element is actually visible in the
    // viewport. If more comments load and push it off-screen before the timer
    // fires, re-scroll — but only if the user hasn't scrolled themselves.
    let dimTimer: ReturnType<typeof setTimeout> | undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Element is visible — start the dim-down timer
            clearTimeout(dimTimer);
            dimTimer = setTimeout(() => {
              setHighlight("subtle");
              observer.disconnect();
            }, 3000);
          } else if (dimTimer !== undefined && !userScrolled) {
            // Pushed off-screen by new content before timer fired — scroll back
            clearTimeout(dimTimer);
            dimTimer = undefined;
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            // User scrolled away — stop tracking
            clearTimeout(dimTimer);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(dimTimer);
      observer.disconnect();
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
      window.removeEventListener("keydown", onUserScroll);
    };
  }, [isTargeted]);

  return (
    <Card
      id={anchorId}
      ref={cardRef}
      className={`overflow-hidden transition-all duration-700 hover:shadow-sm scroll-mt-20 ${
        highlight === "strong"
          ? "ring-2 ring-violet-500/60 border-violet-500/40 shadow-lg shadow-violet-500/15"
          : highlight === "subtle"
            ? "ring-1 ring-violet-500/25 border-violet-500/20"
            : ""
      }`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2">
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
// ThreadedComments — interleaves a thread tree with subject-rename events
// ---------------------------------------------------------------------------

export interface RenameItem {
  event: NostrEvent;
  newSubject: string;
  oldSubject: string;
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
}: {
  tree: { children: ThreadTreeNode[]; event: NostrEvent };
  renameItems: RenameItem[];
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
          <ThreadTree key={item.node.event.id} node={item.node} />
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
