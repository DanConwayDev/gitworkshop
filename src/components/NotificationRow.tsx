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

  // Full layout extras
  const commenters = compact ? [] : getCommenters(item);
  const lastActive = formatDistanceToNow(new Date(item.latestActivity * 1000), {
    addSuffix: true,
  });

  // Compact unread icon
  const UnreadIcon = summary.hasMerge
    ? GitMerge
    : summary.hasClosed
      ? XCircle
      : MessageCircle;
  const unreadIconColor = summary.hasMerge
    ? "text-pink-500"
    : summary.hasClosed
      ? "text-red-500"
      : "text-muted-foreground";

  const dotSize = compact ? "h-1.5 w-1.5" : "h-2 w-2";
  const dotPad = compact ? "" : "pt-1.5";

  return (
    <li
      className={cn(
        "group transition-colors",
        item.unread
          ? compact
            ? "bg-accent/20 border-l-2 border-l-pink-500"
            : "bg-accent/30 hover:bg-accent/50 border-l-2 border-l-pink-500"
          : compact
            ? "border-l-2 border-l-transparent"
            : "hover:bg-accent/20 border-l-2 border-l-transparent",
      )}
    >
      <div className={compact ? undefined : "flex items-start"}>
        <Link
          to={linkPath}
          className={cn(
            "flex items-start gap-3 min-w-0",
            compact ? "px-4 py-3 items-center" : "flex-1 px-3 py-3",
          )}
          onClick={() => actions.markAsRead(item.rootId)}
        >
          {/* Unread dot */}
          <div className={compact ? "shrink-0" : "w-2 pt-1.5 shrink-0"}>
            {item.unread ? (
              <div
                className={cn(
                  "rounded-full bg-pink-500 shrink-0",
                  dotSize,
                  dotPad,
                )}
              />
            ) : (
              <div className={cn(dotSize, "shrink-0")} />
            )}
          </div>

          {/* Type icon */}
          <div className={compact ? undefined : "pt-0.5 shrink-0"}>
            <RootTypeIcon type={rootType} compact={compact} />
          </div>

          {/* Title + metadata */}
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                "text-sm",
                compact ? "truncate" : "line-clamp-1",
                item.unread
                  ? "font-medium text-foreground"
                  : "text-foreground/80",
              )}
            >
              {compact
                ? title.length > 60
                  ? `${title.slice(0, 57)}...`
                  : title
                : title.length > 70
                  ? `${title.slice(0, 67)}...`
                  : title}
            </p>

            {compact ? (
              // Compact sub-row: repo badge + unread text
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {repoCoord && (
                  <RepoBadge coord={repoCoord} repoNameOnly asSpan />
                )}
                {summary.unreadText && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 text-xs",
                      item.unread
                        ? "text-pink-600 dark:text-pink-400 font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    <UnreadIcon className={cn("h-3 w-3", unreadIconColor)} />
                    {summary.unreadText}
                  </span>
                )}
              </div>
            ) : (
              // Full sub-row: timestamp · purpose · unread text · repo badge
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
                    <RepoBadge coord={repoCoord} repoNameOnly asSpan />
                  </>
                )}
              </div>
            )}
          </div>

          {/* Commenter avatars — full layout only, hidden on hover */}
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

          {/* Compact archive button — inside the link area, stops propagation */}
          {compact && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                actions.markAsArchived(item.rootId);
              }}
              title="Archive"
            >
              <Archive className="h-3 w-3" />
            </Button>
          )}
        </Link>

        {/* Full layout action buttons — outside the link, visible on hover */}
        {!compact && (
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
        )}
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

  const avatarSize = compact ? "h-4 w-4 text-[8px]" : "h-5 w-5 text-[8px]";
  const maxActors = compact ? 3 : 5;
  const dotSize = compact ? "h-1.5 w-1.5" : "h-2 w-2";

  return (
    <li
      className={cn(
        "group transition-colors",
        item.unread
          ? compact
            ? "bg-accent/20 border-l-2 border-l-pink-500"
            : "bg-accent/30 hover:bg-accent/50 border-l-2 border-l-pink-500"
          : compact
            ? "border-l-2 border-l-transparent"
            : "hover:bg-accent/20 border-l-2 border-l-transparent",
      )}
    >
      <div className={compact ? undefined : "flex items-start"}>
        <div
          className={cn(
            "flex items-start gap-3 min-w-0 cursor-default",
            compact ? "px-4 py-3 items-center flex-1" : "flex-1 px-3 py-3",
          )}
          onClick={() => actions.markAsRead(item.rootId)}
        >
          {/* Unread dot */}
          {item.unread ? (
            <div className={cn("rounded-full bg-pink-500 shrink-0", dotSize)} />
          ) : (
            <div className={cn(dotSize, "shrink-0")} />
          )}

          {/* Star icon */}
          <Star
            className={cn(
              "text-yellow-500 shrink-0",
              compact ? "h-3.5 w-3.5" : "h-4 w-4",
            )}
          />

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div
              className={cn(
                "flex items-center flex-wrap",
                compact ? "gap-1" : "gap-1.5",
              )}
            >
              {actorPubkeys.slice(0, maxActors).map((pk) => (
                <UserAvatar
                  key={pk}
                  pubkey={pk}
                  size="sm"
                  className={avatarSize}
                />
              ))}
              {actorPubkeys.length > maxActors && (
                <span className="text-xs text-muted-foreground">
                  +{actorPubkeys.length - maxActors}
                </span>
              )}
              <span
                className={cn(
                  "text-sm",
                  compact ? "" : "ml-0.5",
                  item.unread
                    ? "font-medium text-foreground"
                    : "text-foreground/80",
                )}
              >
                starred
              </span>
              {item.repoCoord && (
                <RepoBadge coord={item.repoCoord} repoNameOnly />
              )}
            </div>
            {!compact && (
              <div className="mt-1">
                <span className="text-xs text-muted-foreground">
                  {lastActive}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Full layout action buttons */}
        {!compact && (
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
        )}
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
