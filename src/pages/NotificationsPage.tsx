import { useState, useMemo, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { useActiveAccount } from "applesauce-react/hooks";
import { useSeoMeta } from "@unhead/react";
import { formatDistanceToNow } from "date-fns";
import {
  useNotifications,
  type NotificationActions,
} from "@/hooks/useNotifications";
import type {
  NotificationItem,
  SocialNotificationItem,
} from "@/lib/notifications";
import { ISSUE_KIND, PATCH_KIND, PR_KIND } from "@/lib/nip34";
import { eventIdToNevent } from "@/lib/routeUtils";
import { eventStore, eventLoader } from "@/services/nostr";
import { use$ } from "@/hooks/use$";
import { UserAvatar } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Bell,
  Archive,
  Inbox,
  List,
  Check,
  Eye,
  EyeOff,
  ArchiveRestore,
  CircleDot,
  GitPullRequest,
  GitCommitHorizontal,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  GitMerge,
  XCircle,
  Star,
  Loader2,
} from "lucide-react";
import { RepoBadge } from "@/components/RepoBadge";
import {
  COMMENT_KIND,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_OPEN,
  STATUS_DRAFT,
  PR_UPDATE_KIND,
} from "@/lib/nip34";

type ViewTab = "inbox" | "archived" | "all";

const ITEMS_PER_PAGE = 10;

export default function NotificationsPage() {
  const activeAccount = useActiveAccount();
  const { items, unreadCount, actions, history } = useNotifications();
  const [currentView, setCurrentView] = useState<ViewTab>("inbox");
  const [currentPage, setCurrentPage] = useState(1);

  useSeoMeta({
    title:
      unreadCount > 0
        ? `(${unreadCount}) Notifications - ngit`
        : "Notifications - ngit",
    description: "Your notification inbox",
  });

  // Filter items by current view
  const filteredItems = useMemo(() => {
    if (!items) return undefined;
    switch (currentView) {
      case "inbox":
        return items.filter((item) => !item.archived);
      case "archived":
        return items.filter((item) => item.archived);
      case "all":
        return items;
    }
  }, [items, currentView]);

  // Pagination — reset currentPage when the list shrinks past it (#10)
  const totalPages = filteredItems
    ? Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE))
    : 1;
  const safePage = Math.min(currentPage, totalPages);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);
  const pageItems = filteredItems?.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE,
  );

  // Reset page when switching tabs
  const handleTabChange = useCallback((tab: ViewTab) => {
    setCurrentView(tab);
    setCurrentPage(1);
  }, []);

  if (!activeAccount) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-16">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <Bell className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            Sign in to see your notifications
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>

        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
          <TabButton
            active={currentView === "inbox"}
            onClick={() => handleTabChange("inbox")}
            icon={Inbox}
            label="Inbox"
            badge={unreadCount > 0 ? unreadCount : undefined}
          />
          <TabButton
            active={currentView === "archived"}
            onClick={() => handleTabChange("archived")}
            icon={Archive}
            label="Archived"
          />
          <TabButton
            active={currentView === "all"}
            onClick={() => handleTabChange("all")}
            icon={List}
            label="All"
          />
        </div>
      </div>

      {/* Bulk actions bar */}
      <div className="flex items-center justify-end gap-2 mb-2 min-h-[32px]">
        {currentView === "inbox" &&
          filteredItems &&
          filteredItems.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={actions.markAllAsRead}
              >
                <Check className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={actions.markAllAsArchived}
              >
                <Archive className="h-3 w-3 mr-1" />
                Archive all
              </Button>
            </>
          )}
      </div>

      {/* Notification list */}
      <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
        {!filteredItems ? (
          // Loading skeleton
          <ul className="divide-y divide-border/40">
            {Array.from({ length: 5 }).map((_, i) => (
              <NotificationSkeleton key={i} />
            ))}
          </ul>
        ) : filteredItems.length === 0 ? (
          // Empty state
          <div className="py-16 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-3">
              {currentView === "inbox" ? (
                <>
                  <Inbox className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <p className="text-muted-foreground text-sm">
                    Your inbox is empty. Notifications appear when someone
                    interacts with your repositories.
                  </p>
                </>
              ) : currentView === "archived" ? (
                <>
                  <Archive className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <p className="text-muted-foreground text-sm">
                    No archived notifications.
                  </p>
                </>
              ) : (
                <>
                  <Bell className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <p className="text-muted-foreground text-sm">
                    No notifications yet.
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {pageItems?.map((item) => (
              <NotificationRow
                key={item.rootId}
                item={item}
                actions={actions}
                currentView={currentView}
              />
            ))}
          </ul>
        )}
      </div>

      {/* History load-more / spinner */}
      {(history.loading || history.hasMore) && (
        <div className="flex justify-center mt-3">
          {history.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading older notifications…
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={history.loadMore}
            >
              Load more
            </Button>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={safePage === 1}
            onClick={() => setCurrentPage(1)}
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={safePage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(
              (p) =>
                p === safePage ||
                (p >= Math.max(1, safePage - 2) &&
                  p <= Math.min(totalPages, safePage + 2)),
            )
            .map((p) => (
              <Button
                key={p}
                variant={p === safePage ? "default" : "ghost"}
                size="sm"
                className="h-7 w-7 p-0 text-xs"
                onClick={() => setCurrentPage(p)}
              >
                {p}
              </Button>
            ))}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={safePage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={safePage === totalPages}
            onClick={() => setCurrentPage(totalPages)}
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {badge !== undefined && (
        <Badge
          variant="secondary"
          className="h-4 min-w-[16px] px-1 text-[10px] leading-none"
        >
          {badge}
        </Badge>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Notification row
// ---------------------------------------------------------------------------

/**
 * Determine the "type" of the root event from the notification events.
 * We look at the events in the group — if any is a root kind, use that.
 * Otherwise infer from the #K tag on NIP-22 comments.
 */
function inferRootType(
  item: NotificationItem,
): "issue" | "pr" | "patch" | "unknown" {
  for (const ev of item.events) {
    if (ev.kind === ISSUE_KIND) return "issue";
    if (ev.kind === PR_KIND) return "pr";
    if (ev.kind === PATCH_KIND) return "patch";
  }
  // Check #K tags on comments
  for (const ev of item.events) {
    const kTag = ev.tags.find(([t]) => t === "K")?.[1];
    if (kTag === String(ISSUE_KIND)) return "issue";
    if (kTag === String(PR_KIND)) return "pr";
    if (kTag === String(PATCH_KIND)) return "patch";
  }
  return "unknown";
}

function RootTypeIcon({
  type,
}: {
  type: "issue" | "pr" | "patch" | "unknown";
}) {
  switch (type) {
    case "issue":
      return <CircleDot className="h-4 w-4 text-emerald-500" />;
    case "pr":
      return <GitPullRequest className="h-4 w-4 text-violet-500" />;
    case "patch":
      return <GitCommitHorizontal className="h-4 w-4 text-violet-500" />;
    default:
      return <MessageCircle className="h-4 w-4 text-muted-foreground" />;
  }
}

/**
 * Renders the unread summary with an appropriate icon.
 * Shows merge/close/reopen icons for status changes, comment icon for comments.
 */
function UnreadSummaryBadge({
  summary,
  hasMerge,
  hasClosed,
  isUnread,
}: {
  summary: string;
  hasMerge: boolean;
  hasClosed: boolean;
  isUnread: boolean;
}) {
  const Icon = hasMerge ? GitMerge : hasClosed ? XCircle : MessageCircle;
  const iconColor = hasMerge
    ? "text-violet-500"
    : hasClosed
      ? "text-red-500"
      : "text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs ${isUnread ? "text-violet-600 dark:text-violet-400 font-medium" : "text-muted-foreground"}`}
    >
      <Icon className={`h-3 w-3 ${iconColor}`} />
      {summary}
    </span>
  );
}

/**
 * Extract a display title from a single event (issue/PR/patch).
 */
function titleFromEvent(ev: {
  kind: number;
  tags: string[][];
  content: string;
}): string | undefined {
  if (ev.kind !== ISSUE_KIND && ev.kind !== PR_KIND && ev.kind !== PATCH_KIND) {
    return undefined;
  }
  const subject = ev.tags.find(([t]) => t === "subject")?.[1];
  if (subject) return subject;
  const desc = ev.tags.find(([t]) => t === "description")?.[1];
  if (desc) {
    const firstLine = desc.split("\n")[0];
    if (firstLine) return firstLine;
  }
  const firstLine = ev.content.split("\n")[0];
  if (firstLine) return firstLine.slice(0, 80);
  return undefined;
}

/**
 * Hook that fetches the root event for a notification group from the
 * EventStore. One subscription per row — both title and repo coord are
 * derived from the same result so we never create duplicate subscriptions.
 *
 * Fires eventLoader for the rootId so the event is fetched if missing.
 */
function useRootEvent(rootId: string) {
  // A valid Nostr event ID is exactly 64 hex chars. Social notification
  // rootIds are synthetic strings (e.g. "stars:30617:pk:dtag") — skip the
  // subscription entirely for those to avoid dead timeline subscriptions.
  const isEventId = rootId.length === 64;

  const rootEvents = use$(() => {
    if (!isEventId) return undefined;
    return eventStore.timeline([{ ids: [rootId] }]);
  }, [rootId, isEventId]);

  // Fire the loader once if the root event isn't in the store yet.
  useEffect(() => {
    if (isEventId && (!rootEvents || rootEvents.length === 0)) {
      eventLoader({ id: rootId }).subscribe();
    }
  }, [rootId, isEventId, rootEvents]);

  return rootEvents?.[0];
}

/** Derive the display title from the root event + notification group events. */
function resolveTitle(
  rootEvent: ReturnType<typeof useRootEvent>,
  item: NotificationItem,
): string {
  if (rootEvent) {
    const title = titleFromEvent(rootEvent);
    if (title) return title;
  }
  // Fast path: root event is already in the notification group
  for (const ev of item.events) {
    const title = titleFromEvent(ev);
    if (title) return title;
  }
  return `Activity on ${item.rootId.slice(0, 8)}...`;
}

/** Derive the repo coord from the root event + notification group events. */
function resolveRepoCoord(
  rootEvent: ReturnType<typeof useRootEvent>,
  item: NotificationItem,
): string | undefined {
  // Check the root event first (most reliable source of the `a` tag)
  if (rootEvent) {
    const aTag = rootEvent.tags.find(([t]) => t === "a")?.[1];
    if (aTag?.startsWith("30617:")) return aTag;
  }
  // Fall back to scanning notification events (works for root-kind notifications
  // where the issue/PR/patch event itself is in the group)
  for (const ev of item.events) {
    const aTag = ev.tags.find(([t]) => t === "a")?.[1];
    if (aTag?.startsWith("30617:")) return aTag;
  }
  return undefined;
}

/** Get unique commenter pubkeys from the notification events */
function getCommenters(item: NotificationItem): string[] {
  const pubkeys = new Set<string>();
  for (const ev of item.events) {
    pubkeys.add(ev.pubkey);
  }
  return Array.from(pubkeys).slice(0, 5);
}

interface NotificationSummary {
  /** Always-visible purpose label, e.g. "new issue", "new PR", "new commits pushed" */
  purpose: string | undefined;
  /** Unread activity text, e.g. "merged", "3 new comments" */
  unreadText: string | undefined;
  hasMerge: boolean;
  hasClosed: boolean;
}

/**
 * Build a human-readable summary for a notification group.
 *
 * `purpose` describes what triggered the notification (always shown):
 *   - "new issue" / "new PR" / "new patch" when the root event is in the group
 *   - "new commits pushed" when a PR Update (kind:1619) is in the group
 *   - undefined for comment-only notifications (the title already says it all)
 *
 * `unreadText` describes the unread activity (shown only when unread):
 *   - "merged", "closed", "reopened", "marked draft"
 *   - "new revision"
 *   - "N new comment(s)"
 *
 * When both are present they are rendered separately so the caller can style
 * them differently. The caller joins them with " · ".
 */
function buildNotificationSummary(item: NotificationItem): NotificationSummary {
  // ── Determine purpose from all events in the group ──────────────────────
  let purpose: string | undefined;
  let hasNewCommits = false;

  for (const ev of item.events) {
    if (ev.kind === ISSUE_KIND) {
      purpose = "new issue";
      break;
    }
    if (ev.kind === PR_KIND) {
      purpose = "new PR";
      break;
    }
    if (ev.kind === PATCH_KIND) {
      purpose = "new patch";
      break;
    }
    if (ev.kind === PR_UPDATE_KIND) {
      hasNewCommits = true;
    }
  }

  if (!purpose && hasNewCommits) {
    purpose = "new commits pushed";
  }

  // ── Determine unread activity ────────────────────────────────────────────
  if (!item.unread || item.unreadEventIds.length === 0) {
    return {
      purpose,
      unreadText: undefined,
      hasMerge: false,
      hasClosed: false,
    };
  }

  const unreadIdSet = new Set(item.unreadEventIds);
  const unreadEvents = item.events.filter((ev) => unreadIdSet.has(ev.id));

  let commentCount = 0;
  let merged = false;
  let closed = false;
  let reopened = false;
  let drafted = false;
  let newRevision = false;

  for (const ev of unreadEvents) {
    if (ev.kind === COMMENT_KIND || ev.kind === 1 || ev.kind === 1622) {
      commentCount++;
    } else if (ev.kind === STATUS_RESOLVED) {
      merged = true;
    } else if (ev.kind === STATUS_CLOSED) {
      closed = true;
    } else if (ev.kind === STATUS_OPEN) {
      reopened = true;
    } else if (ev.kind === STATUS_DRAFT) {
      drafted = true;
    } else if (ev.kind === PR_UPDATE_KIND) {
      newRevision = true;
    }
  }

  const parts: string[] = [];

  if (merged) parts.push("merged");
  else if (closed) parts.push("closed");
  else if (reopened) parts.push("reopened");
  else if (drafted) parts.push("marked draft");

  if (newRevision) parts.push("new revision");

  if (commentCount > 0) {
    parts.push(
      `${commentCount} new ${commentCount === 1 ? "comment" : "comments"}`,
    );
  }

  const unreadText = parts.length > 0 ? parts.join(" · ") : undefined;
  return { purpose, unreadText, hasMerge: merged, hasClosed: closed };
}

/**
 * Build the link path for a notification item, appending an `?unread=` query
 * param with the first 15 chars of each unread event ID (oldest-first).
 * The first ID is also used as the hash anchor so the page scrolls to the
 * oldest unread content.
 */
function buildNotificationLink(nevent: string, item: NotificationItem): string {
  const base = `/${nevent}`;
  if (item.unreadEventIds.length === 0) return base;

  // Use first 15 chars of each ID — matches the anchor format in ThreadComment
  const anchors = item.unreadEventIds.map((id) => id.slice(0, 15));
  const params = new URLSearchParams({ unread: anchors.join(",") });
  // Anchor to the oldest unread event (first in the oldest-first list)
  return `${base}?${params.toString()}#${anchors[0]}`;
}

function NotificationRow({
  item,
  actions,
  currentView,
}: {
  item: NotificationItem;
  actions: NotificationActions;
  currentView: ViewTab;
}) {
  // Always call hooks unconditionally — React rules of hooks.
  // For social items rootId is synthetic; useRootEvent returns undefined.
  const rootEvent = useRootEvent(item.rootId);

  if (item.kind !== "thread") {
    return (
      <SocialNotificationRow
        item={item}
        actions={actions}
        currentView={currentView}
      />
    );
  }

  const rootType = inferRootType(item);
  const title = resolveTitle(rootEvent, item);
  const repoCoord = resolveRepoCoord(rootEvent, item);
  const commenters = getCommenters(item);
  const lastActive = formatDistanceToNow(new Date(item.latestActivity * 1000), {
    addSuffix: true,
  });
  const nevent = eventIdToNevent(item.rootId);
  const summary = buildNotificationSummary(item);

  // Determine the link path based on root type, with unread anchor
  const linkPath = buildNotificationLink(nevent, item);

  return (
    <li
      className={cn(
        "group transition-colors",
        item.unread
          ? "bg-accent/30 hover:bg-accent/50 border-l-2 border-l-violet-500"
          : "hover:bg-accent/20 border-l-2 border-l-transparent",
      )}
    >
      <div className="flex items-start">
        {/* Main content — clickable link */}
        <Link
          to={linkPath}
          className="flex-1 flex items-start gap-3 px-3 py-3 min-w-0"
          onClick={() => actions.markAsRead(item.rootId)}
        >
          {/* Unread dot */}
          <div className="w-2 pt-1.5 shrink-0">
            {item.unread && (
              <div className="h-2 w-2 rounded-full bg-violet-500" />
            )}
          </div>

          {/* Type icon */}
          <div className="pt-0.5 shrink-0">
            <RootTypeIcon type={rootType} />
          </div>

          {/* Title + metadata */}
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                "text-sm line-clamp-1",
                item.unread
                  ? "font-medium text-foreground"
                  : "text-foreground/80",
              )}
            >
              {title.length > 70 ? `${title.slice(0, 67)}...` : title}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground shrink-0">
                active {lastActive}
              </span>
              {/* Purpose label — always shown when available */}
              {summary.purpose && (
                <>
                  <span className="text-muted-foreground/40 text-xs">
                    &middot;
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {summary.purpose}
                  </span>
                </>
              )}
              {/* Unread activity — shown only when there is unread content */}
              {summary.unreadText && (
                <>
                  <span className="text-muted-foreground/40 text-xs">
                    &middot;
                  </span>
                  <UnreadSummaryBadge
                    summary={summary.unreadText}
                    hasMerge={summary.hasMerge}
                    hasClosed={summary.hasClosed}
                    isUnread={item.unread}
                  />
                </>
              )}
              {repoCoord && (
                <>
                  <span className="text-muted-foreground/40 text-xs">
                    &middot;
                  </span>
                  <RepoBadge coord={repoCoord} repoNameOnly />
                </>
              )}
            </div>
          </div>

          {/* Commenter avatars — hidden on small screens, hidden on hover for action buttons */}
          <div className="hidden md:flex items-center gap-1 self-center shrink-0 group-hover:hidden">
            {commenters.slice(0, 3).map((pk) => (
              <UserAvatar
                key={pk}
                pubkey={pk}
                size="sm"
                className="h-5 w-5 text-[8px] opacity-60"
              />
            ))}
            {commenters.length > 3 && (
              <span className="text-[10px] text-muted-foreground/60">
                +{commenters.length - 3}
              </span>
            )}
          </div>
        </Link>

        {/* Action buttons — visible on hover */}
        <div className="hidden md:group-hover:flex items-center gap-1 self-center pr-3 shrink-0">
          {item.unread ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.markAsRead(item.rootId)}
            >
              <Eye className="h-3 w-3 mr-1" />
              Read
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.markAsUnread(item.rootId)}
            >
              <EyeOff className="h-3 w-3 mr-1" />
              Unread
            </Button>
          )}
          {currentView === "inbox" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.markAsArchived(item.rootId)}
            >
              <Archive className="h-3 w-3 mr-1" />
              Archive
            </Button>
          )}
          {currentView === "archived" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.markAsUnarchived(item.rootId)}
            >
              <ArchiveRestore className="h-3 w-3 mr-1" />
              Inbox
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Social notification row
// ---------------------------------------------------------------------------

function SocialNotificationRow({
  item,
  actions,
  currentView,
}: {
  item: SocialNotificationItem;
  actions: NotificationActions;
  currentView: ViewTab;
}) {
  const lastActive = formatDistanceToNow(new Date(item.latestActivity * 1000), {
    addSuffix: true,
  });

  // Unique pubkeys from the events, newest-first (events are already sorted)
  const actorPubkeys = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const ev of item.events) {
      if (!seen.has(ev.pubkey)) {
        seen.add(ev.pubkey);
        result.push(ev.pubkey);
      }
    }
    return result;
  }, [item.events]);

  const Icon = Star;
  const iconColor = "text-yellow-500";
  const label = "starred";

  return (
    <li
      className={cn(
        "group transition-colors",
        item.unread
          ? "bg-accent/30 hover:bg-accent/50 border-l-2 border-l-violet-500"
          : "hover:bg-accent/20 border-l-2 border-l-transparent",
      )}
    >
      <div className="flex items-start">
        <div
          className="flex-1 flex items-start gap-3 px-3 py-3 min-w-0 cursor-default"
          onClick={() => actions.markAsRead(item.rootId)}
        >
          {/* Unread dot */}
          <div className="w-2 pt-1.5 shrink-0">
            {item.unread && (
              <div className="h-2 w-2 rounded-full bg-violet-500" />
            )}
          </div>

          {/* Type icon */}
          <div className="pt-0.5 shrink-0">
            <Icon className={cn("h-4 w-4", iconColor)} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Actor avatars inline with label */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {actorPubkeys.slice(0, 5).map((pk) => (
                <UserAvatar
                  key={pk}
                  pubkey={pk}
                  size="sm"
                  className="h-5 w-5 text-[8px]"
                />
              ))}
              {actorPubkeys.length > 5 && (
                <span className="text-xs text-muted-foreground">
                  +{actorPubkeys.length - 5}
                </span>
              )}
              <span
                className={cn(
                  "text-sm",
                  item.unread
                    ? "font-medium text-foreground"
                    : "text-foreground/80",
                )}
              >
                {label}
              </span>
              {item.repoCoord && (
                <RepoBadge coord={item.repoCoord} repoNameOnly />
              )}
            </div>
            <div className="mt-1">
              <span className="text-xs text-muted-foreground">
                {lastActive}
              </span>
            </div>
          </div>
        </div>

        {/* Action buttons — visible on hover */}
        <div className="hidden md:group-hover:flex items-center gap-1 self-center pr-3 shrink-0">
          {item.unread ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.markAsRead(item.rootId)}
            >
              <Eye className="h-3 w-3 mr-1" />
              Read
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.markAsUnread(item.rootId)}
            >
              <EyeOff className="h-3 w-3 mr-1" />
              Unread
            </Button>
          )}
          {currentView === "inbox" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.markAsArchived(item.rootId)}
            >
              <Archive className="h-3 w-3 mr-1" />
              Archive
            </Button>
          )}
          {currentView === "archived" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.markAsUnarchived(item.rootId)}
            >
              <ArchiveRestore className="h-3 w-3 mr-1" />
              Inbox
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function NotificationSkeleton() {
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <div className="w-2 shrink-0" />
      <Skeleton className="h-4 w-4 rounded shrink-0 mt-0.5" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </li>
  );
}
