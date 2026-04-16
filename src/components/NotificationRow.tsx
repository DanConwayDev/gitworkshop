/**
 * Shared notification row components used by both NotificationsPage (full)
 * and the Dashboard compact panel.
 *
 * Pass compact={true} for the dashboard panel — tighter layout, no timestamp,
 * no read/unread toggle, just a quick archive button on hover.
 * The default (compact={false}) is the full notifications-page layout.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  CircleDot,
  GitPullRequest,
  GitCommitHorizontal,
  MessageCircle,
  GitMerge,
  XCircle,
  Star,
  Archive,
  ArchiveRestore,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { RepoBadge } from "@/components/RepoBadge";
import { cn } from "@/lib/utils";
import { useRootEvent } from "@/hooks/useRootEvent";
import {
  inferRootType,
  resolveTitle,
  resolveRepoCoord,
  getCommenters,
  getActorPubkeys,
  buildNotificationSummary,
  buildNotificationLink,
} from "@/lib/notificationUtils";
import { eventIdToNevent } from "@/lib/routeUtils";
import type { NotificationActions } from "@/hooks/useNotifications";
import type {
  NotificationItem,
  SocialNotificationItem,
} from "@/lib/notifications";

// ---------------------------------------------------------------------------
// ViewTab — only relevant for the full layout's action buttons
// ---------------------------------------------------------------------------

export type ViewTab = "inbox" | "archived" | "all";

// ---------------------------------------------------------------------------
// Root type icon
// ---------------------------------------------------------------------------

function RootTypeIcon({
  type,
  compact,
}: {
  type: "issue" | "pr" | "patch" | "unknown";
  compact: boolean;
}) {
  const size = compact ? "h-3.5 w-3.5 shrink-0" : "h-4 w-4";
  switch (type) {
    case "issue":
      return <CircleDot className={cn(size, "text-emerald-500")} />;
    case "pr":
      return <GitPullRequest className={cn(size, "text-pink-500")} />;
    case "patch":
      return <GitCommitHorizontal className={cn(size, "text-pink-500")} />;
    default:
      return <MessageCircle className={cn(size, "text-muted-foreground")} />;
  }
}

// ---------------------------------------------------------------------------
// Unread summary badge (full layout only)
// ---------------------------------------------------------------------------

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
    ? "text-pink-500"
    : hasClosed
      ? "text-red-500"
      : "text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs ${isUnread ? "text-pink-600 dark:text-pink-400 font-medium" : "text-muted-foreground"}`}
    >
      <Icon className={`h-3 w-3 ${iconColor}`} />
      {summary}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Thread notification row
// ---------------------------------------------------------------------------

function ThreadNotificationRow({
  item,
  actions,
  compact,
  currentView,
}: {
  item: NotificationItem;
  actions: NotificationActions;
  compact: boolean;
  currentView: ViewTab;
}) {
  const rootEvent = useRootEvent(item.rootId);

  const rootType = inferRootType(item);
  const title = resolveTitle(rootEvent, item);
  const repoCoord = resolveRepoCoord(rootEvent, item);
  const summary = buildNotificationSummary(item);
  const nevent = eventIdToNevent(item.rootId);
  const linkPath = buildNotificationLink(nevent, item);

  const commenters = compact ? [] : getCommenters(item);
  const lastActive = formatDistanceToNow(new Date(item.latestActivity * 1000), {
    addSuffix: true,
  });

  return (
    <li
      className={cn(
        "group transition-colors",
        item.unread
          ? "bg-accent/30 hover:bg-accent/50 border-l-2 border-l-pink-500"
          : "hover:bg-accent/20 border-l-2 border-l-transparent",
      )}
    >
      <div className="flex items-start">
        <Link
          to={linkPath}
          className="flex items-start gap-3 min-w-0 flex-1 px-3 py-3"
          onClick={() => actions.markAsRead(item.rootId)}
        >
          {/* Unread dot */}
          <div className="w-2 pt-1.5 shrink-0">
            {item.unread ? (
              <div className="h-2 w-2 rounded-full bg-pink-500 shrink-0" />
            ) : (
              <div className="h-2 w-2 shrink-0" />
            )}
          </div>

          {/* Type icon */}
          <div className="pt-0.5 shrink-0">
            <RootTypeIcon type={rootType} compact={compact} />
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

            {/* Sub-row: timestamp · purpose · unread text · repo badge */}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground shrink-0">
                active {lastActive}
              </span>
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
                  <RepoBadge coord={repoCoord} asSpan />
                </>
              )}
            </div>
          </div>

          {/* Commenter avatars — hidden on hover, hidden in compact */}
          {!compact && (
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
          )}
        </Link>

        {/* Action buttons — outside the link, visible on hover. Icon-only when compact. */}
        <div className="hidden md:group-hover:flex items-center gap-1 self-center pr-3 shrink-0">
          {item.unread ? (
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 text-xs", compact && "w-7 p-0")}
              onClick={() => actions.markAsRead(item.rootId)}
              title="Mark as read"
            >
              <Eye className={cn("h-3 w-3", !compact && "mr-1")} />
              {!compact && "Read"}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 text-xs", compact && "w-7 p-0")}
              onClick={() => actions.markAsUnread(item.rootId)}
              title="Mark as unread"
            >
              <EyeOff className={cn("h-3 w-3", !compact && "mr-1")} />
              {!compact && "Unread"}
            </Button>
          )}
          {currentView === "inbox" && (
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 text-xs", compact && "w-7 p-0")}
              onClick={() => actions.markAsArchived(item.rootId)}
              title="Archive"
            >
              <Archive className={cn("h-3 w-3", !compact && "mr-1")} />
              {!compact && "Archive"}
            </Button>
          )}
          {currentView === "archived" && (
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 text-xs", compact && "w-7 p-0")}
              onClick={() => actions.markAsUnarchived(item.rootId)}
              title="Move to inbox"
            >
              <ArchiveRestore className={cn("h-3 w-3", !compact && "mr-1")} />
              {!compact && "Inbox"}
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
  compact,
  currentView,
}: {
  item: SocialNotificationItem;
  actions: NotificationActions;
  compact: boolean;
  currentView: ViewTab;
}) {
  const actorPubkeys = useMemo(() => getActorPubkeys(item), [item]);
  const lastActive = formatDistanceToNow(new Date(item.latestActivity * 1000), {
    addSuffix: true,
  });

  return (
    <li
      className={cn(
        "group transition-colors",
        item.unread
          ? "bg-accent/30 hover:bg-accent/50 border-l-2 border-l-pink-500"
          : "hover:bg-accent/20 border-l-2 border-l-transparent",
      )}
    >
      <div className="flex items-start">
        <div
          className="flex items-start gap-3 min-w-0 cursor-default flex-1 px-3 py-3"
          onClick={() => actions.markAsRead(item.rootId)}
        >
          {/* Unread dot */}
          <div className="w-2 pt-1.5 shrink-0">
            {item.unread ? (
              <div className="h-2 w-2 rounded-full bg-pink-500 shrink-0" />
            ) : (
              <div className="h-2 w-2 shrink-0" />
            )}
          </div>

          {/* Star icon */}
          <Star className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />

          {/* Content */}
          <div className="flex-1 min-w-0">
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
                  "text-sm ml-0.5",
                  item.unread
                    ? "font-medium text-foreground"
                    : "text-foreground/80",
                )}
              >
                starred
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground shrink-0">
                {lastActive}
              </span>
              {item.repoCoord && (
                <>
                  <span className="text-muted-foreground/40 text-xs">
                    &middot;
                  </span>
                  <RepoBadge coord={item.repoCoord} asSpan />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons — icon-only when compact */}
        <div className="hidden md:group-hover:flex items-center gap-1 self-center pr-3 shrink-0">
          {item.unread ? (
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 text-xs", compact && "w-7 p-0")}
              onClick={() => actions.markAsRead(item.rootId)}
              title="Mark as read"
            >
              <Eye className={cn("h-3 w-3", !compact && "mr-1")} />
              {!compact && "Read"}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 text-xs", compact && "w-7 p-0")}
              onClick={() => actions.markAsUnread(item.rootId)}
              title="Mark as unread"
            >
              <EyeOff className={cn("h-3 w-3", !compact && "mr-1")} />
              {!compact && "Unread"}
            </Button>
          )}
          {currentView === "inbox" && (
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 text-xs", compact && "w-7 p-0")}
              onClick={() => actions.markAsArchived(item.rootId)}
              title="Archive"
            >
              <Archive className={cn("h-3 w-3", !compact && "mr-1")} />
              {!compact && "Archive"}
            </Button>
          )}
          {currentView === "archived" && (
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 text-xs", compact && "w-7 p-0")}
              onClick={() => actions.markAsUnarchived(item.rootId)}
              title="Move to inbox"
            >
              <ArchiveRestore className={cn("h-3 w-3", !compact && "mr-1")} />
              {!compact && "Inbox"}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function NotificationRow({
  item,
  actions,
  compact = false,
  currentView = "inbox",
}: {
  item: NotificationItem;
  actions: NotificationActions;
  compact?: boolean;
  currentView?: ViewTab;
}) {
  // Always call hooks unconditionally — React rules of hooks.
  // useRootEvent is called inside ThreadNotificationRow, but we need to
  // dispatch before that. Social items have synthetic rootIds so we pass
  // through to SocialNotificationRow which doesn't call it.
  if (item.kind !== "thread") {
    return (
      <SocialNotificationRow
        item={item as SocialNotificationItem}
        actions={actions}
        compact={compact}
        currentView={currentView}
      />
    );
  }
  return (
    <ThreadNotificationRow
      item={item}
      actions={actions}
      compact={compact}
      currentView={currentView}
    />
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function NotificationSkeleton() {
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
