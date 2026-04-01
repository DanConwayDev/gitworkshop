import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { useActiveAccount } from "applesauce-react/hooks";
import { useSeoMeta } from "@unhead/react";
import { formatDistanceToNow } from "date-fns";
import {
  useNotifications,
  type NotificationActions,
} from "@/hooks/useNotifications";
import type { NotificationItem } from "@/lib/notifications";
import { ISSUE_KIND, PATCH_KIND, PR_KIND } from "@/lib/nip34";
import { eventIdToNevent } from "@/lib/routeUtils";
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
} from "lucide-react";

type ViewTab = "inbox" | "archived" | "all";

const ITEMS_PER_PAGE = 10;

export default function NotificationsPage() {
  const activeAccount = useActiveAccount();
  const { items, unreadCount, actions } = useNotifications();
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

  // Pagination
  const totalPages = filteredItems
    ? Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE))
    : 1;
  const safePage = Math.min(currentPage, totalPages);
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
 * Extract a display title from the notification events.
 * Looks for a subject tag on root events, or falls back to content preview.
 */
function extractTitle(item: NotificationItem): string {
  // Look for a root event with a subject tag
  for (const ev of item.events) {
    if (
      ev.kind === ISSUE_KIND ||
      ev.kind === PR_KIND ||
      ev.kind === PATCH_KIND
    ) {
      const subject = ev.tags.find(([t]) => t === "subject")?.[1];
      if (subject) return subject;
      // Patches use description tag
      const desc = ev.tags.find(([t]) => t === "description")?.[1];
      if (desc) {
        const firstLine = desc.split("\n")[0];
        return firstLine || "(untitled)";
      }
      // Fall back to content first line
      const firstLine = ev.content.split("\n")[0];
      if (firstLine) return firstLine.slice(0, 80);
    }
  }
  // No root event in the group — show a generic title
  return `Activity on ${item.rootId.slice(0, 8)}...`;
}

/** Get unique commenter pubkeys from the notification events */
function getCommenters(item: NotificationItem): string[] {
  const pubkeys = new Set<string>();
  for (const ev of item.events) {
    pubkeys.add(ev.pubkey);
  }
  return Array.from(pubkeys).slice(0, 5);
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
  const rootType = inferRootType(item);
  const title = extractTitle(item);
  const commenters = getCommenters(item);
  const lastActive = formatDistanceToNow(new Date(item.latestActivity * 1000), {
    addSuffix: true,
  });
  const nevent = eventIdToNevent(item.rootId);

  // Determine the link path based on root type
  const linkPath = `/${nevent}`;

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
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span>active {lastActive}</span>
              {item.events.length > 1 && (
                <>
                  <span className="text-muted-foreground/40">&middot;</span>
                  <span className="inline-flex items-center gap-0.5">
                    <MessageCircle className="h-3 w-3" />
                    {item.events.length}
                  </span>
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
