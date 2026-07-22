/**
 * Shared notification row components used by both NotificationsPage (full)
 * and the Dashboard compact panel.
 *
 * Pass compact={true} for the dashboard panel — tighter layout, no timestamp,
 * no read/unread toggle, just a quick archive button on hover.
 * The default (compact={false}) is the full notifications-page layout.
 */

import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { useActiveAccount } from "applesauce-react/hooks";
import {
  CircleDot,
  GitPullRequest,
  GitCommitHorizontal,
  MessageCircle,
  GitMerge,
  XCircle,
  Star,
  Zap,
  Archive,
  ArchiveRestore,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar, UserLink, UserName } from "@/components/UserAvatar";
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
import {
  COMMENT_KIND,
  ISSUE_KIND,
  LEGACY_REPLY_KIND,
  PATCH_KIND,
  PR_KIND,
  PR_UPDATE_KIND,
  REPO_KIND,
} from "@/lib/nip34";
import { StatusIcon } from "@/components/StatusIcon";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import type { NotificationActions } from "@/hooks/useNotifications";
import type {
  NotificationItem,
  SocialNotificationItem,
  RepoZapNotificationItem,
  ThreadNotificationItem,
} from "@/lib/notifications";
import type { ResolvedIssueLite } from "@/lib/nip34";
import type { NostrEvent } from "nostr-tools";

function repoCoordToNaddrPath(coord: string): string | undefined {
  const [kind, pubkey, ...identifierParts] = coord.split(":");
  const identifier = identifierParts.join(":");

  if (
    kind !== String(REPO_KIND) ||
    !/^[0-9a-f]{64}$/.test(pubkey) ||
    !identifier
  ) {
    return undefined;
  }

  return `/${nip19.naddrEncode({
    kind: REPO_KIND,
    pubkey,
    identifier,
  })}`;
}

function RepoNotificationLink({
  to,
  rootId,
  actions,
  children,
}: {
  to: string | undefined;
  rootId: string;
  actions: NotificationActions;
  children: ReactNode;
}) {
  const className = "flex items-start gap-3 min-w-0 flex-1 px-3 py-3";

  if (!to) {
    return (
      <div
        className={cn(className, "cursor-default")}
        onClick={() => actions.markAsRead(rootId)}
      >
        {children}
      </div>
    );
  }

  return (
    <Link
      to={to}
      className={cn(className, "cursor-pointer")}
      onClick={() => actions.markAsRead(rootId)}
    >
      {children}
    </Link>
  );
}

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
}: {
  summary: string;
  hasMerge: boolean;
  hasClosed: boolean;
}) {
  const Icon = hasMerge ? GitMerge : hasClosed ? XCircle : MessageCircle;
  const iconColor = hasMerge
    ? "text-pink-500"
    : hasClosed
      ? "text-red-500"
      : "text-muted-foreground";

  return (
    <Badge
      variant="secondary"
      className="h-5 gap-1 px-1.5 text-[11px] font-medium"
    >
      <Icon className={cn("h-3 w-3", iconColor)} />
      {summary}
    </Badge>
  );
}

function RootPurposeBadge({
  purpose,
  isUnread,
}: {
  purpose: string;
  isUnread: boolean;
}) {
  return (
    <Badge
      variant={isUnread ? "default" : "secondary"}
      className={cn(
        "h-5 px-1.5 text-[11px] font-semibold capitalize",
        isUnread && "bg-pink-600 hover:bg-pink-600",
      )}
    >
      {purpose}
    </Badge>
  );
}

function ActivityActors({ pubkeys }: { pubkeys: string[] }) {
  if (pubkeys.length === 0) return null;

  const actor = (pubkey: string) => (
    <UserLink
      key={pubkey}
      pubkey={pubkey}
      noLink
      className="inline-flex rounded-full bg-muted/70 py-0.5 pl-0.5 pr-2 text-foreground"
      nameClassName="text-xs"
    />
  );

  if (pubkeys.length === 1) return actor(pubkeys[0]);
  if (pubkeys.length === 2) {
    return (
      <>
        {actor(pubkeys[0])} <span>and</span> {actor(pubkeys[1])}
      </>
    );
  }
  if (pubkeys.length === 3) {
    return (
      <>
        {actor(pubkeys[0])}, {actor(pubkeys[1])} <span>and</span>{" "}
        {actor(pubkeys[2])}
      </>
    );
  }

  const avatarPubkeys = pubkeys.slice(2, 6);
  const remainingCount = pubkeys.length - avatarPubkeys.length - 2;
  return (
    <>
      {actor(pubkeys[0])}, {actor(pubkeys[1])} <span>and</span>
      <span className="inline-flex -space-x-1.5 align-middle">
        {avatarPubkeys.map((pubkey) => (
          <UserAvatar
            key={pubkey}
            pubkey={pubkey}
            size="sm"
            className="h-5 w-5 border border-background text-[8px]"
            noHoverCard
          />
        ))}
      </span>
      {remainingCount > 0 && <span>+{remainingCount}</span>}
    </>
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
  resolvedMap,
}: {
  item: NotificationItem;
  actions: NotificationActions;
  compact: boolean;
  currentView: ViewTab;
  resolvedMap?: Map<string, ResolvedIssueLite>;
}) {
  const activeAccount = useActiveAccount();
  const rootEvent = useRootEvent(item.rootId);

  const resolved = resolvedMap?.get(item.rootId);
  const rootType = inferRootType(item);
  const title = resolved?.currentSubject ?? resolveTitle(rootEvent, item);
  const repoCoord = resolveRepoCoord(rootEvent, item);
  const isOwnRepository = repoCoord
    ? repoOwnerPubkey(repoCoord) === activeAccount?.pubkey
    : false;
  const summary = buildNotificationSummary(item);
  const isNewRoot = ["new issue", "new PR", "new patch"].includes(
    summary.purpose ?? "",
  );
  const nevent = eventIdToNevent(item.rootId);
  const linkPath = buildNotificationLink(nevent, item);

  const unreadCommenters =
    compact || !item.unread
      ? []
      : getCommenters({
          ...item,
          events: item.events.filter((event) =>
            item.unreadEventIds.includes(event.id),
          ),
        });
  const lastActive = useRelativeTime(item.latestActivity);

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

          {/* Type / status icon */}
          <div className="pt-0.5 shrink-0">
            {resolved ? (
              <StatusIcon
                status={resolved.status}
                variant={
                  rootType === "patch"
                    ? "patch"
                    : rootType === "pr"
                      ? "pr"
                      : "issue"
                }
                className={compact ? "h-3.5 w-3.5" : "h-4 w-4"}
              />
            ) : (
              <RootTypeIcon type={rootType} compact={compact} />
            )}
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

            {/* Latest activity author + root/unread state */}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {summary.purpose &&
                (isNewRoot ? (
                  <RootPurposeBadge
                    purpose={summary.purpose}
                    isUnread={item.unread}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {summary.purpose}
                  </span>
                ))}
              {summary.unreadText && (
                <UnreadSummaryBadge
                  summary={summary.unreadText}
                  hasMerge={summary.hasMerge}
                  hasClosed={summary.hasClosed}
                />
              )}
              {unreadCommenters[0] && (
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <ActivityActors pubkeys={unreadCommenters} />
                </span>
              )}
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                active {lastActive}
              </span>
            </div>
          </div>

          {/* Root context occupies the former activity-avatar position. */}
          <div className="hidden items-center self-center shrink-0 text-right md:flex group-hover:hidden">
            {repoCoord && (
              <RepoBadge
                coord={repoCoord}
                repoNameOnly={isOwnRepository}
                asSpan
              />
            )}
          </div>
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
  const lastActive = useRelativeTime(item.latestActivity);
  const linkPath = repoCoordToNaddrPath(item.repoCoord);

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
        <RepoNotificationLink
          to={linkPath}
          rootId={item.rootId}
          actions={actions}
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
        </RepoNotificationLink>

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
// Repo zap notification row
// ---------------------------------------------------------------------------

function RepoZapNotificationRow({
  item,
  actions,
  compact,
  currentView,
}: {
  item: RepoZapNotificationItem;
  actions: NotificationActions;
  compact: boolean;
  currentView: ViewTab;
}) {
  const actorPubkeys = useMemo(() => getActorPubkeys(item), [item]);
  const lastActive = useRelativeTime(item.latestActivity);
  const linkPath = repoCoordToNaddrPath(item.repoCoord);

  // Format sats compactly for display
  const satsLabel =
    item.totalSats >= 1_000_000
      ? `${(item.totalSats / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
      : item.totalSats >= 1_000
        ? `${(item.totalSats / 1_000).toFixed(1).replace(/\.0$/, "")}k`
        : String(item.totalSats);

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
        <RepoNotificationLink
          to={linkPath}
          rootId={item.rootId}
          actions={actions}
        >
          {/* Unread dot */}
          <div className="w-2 pt-1.5 shrink-0">
            {item.unread ? (
              <div className="h-2 w-2 rounded-full bg-pink-500 shrink-0" />
            ) : (
              <div className="h-2 w-2 shrink-0" />
            )}
          </div>

          {/* Zap icon */}
          <Zap className="h-4 w-4 text-amber-400 shrink-0 mt-0.5 fill-amber-400" />

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
                zapped
              </span>
              {item.totalSats > 0 && (
                <span className="text-xs text-amber-500 font-medium">
                  {satsLabel} sats
                </span>
              )}
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
        </RepoNotificationLink>

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
// Ungrouped thread activity row
// ---------------------------------------------------------------------------

function activityVerb(event: NostrEvent): string {
  if (event.kind === COMMENT_KIND || event.kind === LEGACY_REPLY_KIND) {
    return "commented on";
  }
  if (event.kind === PR_KIND) return "opened a pull request";
  if (event.kind === ISSUE_KIND) return "opened an issue";
  if (event.kind === PATCH_KIND) return "sent a patch";
  if (event.kind === PR_UPDATE_KIND) return "pushed an update to";
  return "updated";
}

function repoOwnerPubkey(coord: string): string | undefined {
  const [, pubkey] = coord.split(":");
  return /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : undefined;
}

/**
 * Actor-first, one-event notification row used when root-item grouping is off.
 * It deliberately marks only this event as read or archived so sibling activity
 * on the same issue or PR remains visible.
 */
export function NotificationActivityRow({
  item,
  event,
  actions,
  currentView,
  resolvedMap,
}: {
  item: ThreadNotificationItem;
  event: NostrEvent;
  actions: NotificationActions;
  currentView: ViewTab;
  resolvedMap?: Map<string, ResolvedIssueLite>;
}) {
  const activeAccount = useActiveAccount();
  const rootEvent = useRootEvent(item.rootId);
  const resolved = resolvedMap?.get(item.rootId);
  const rootType = inferRootType(item);
  const title = resolved?.currentSubject ?? resolveTitle(rootEvent, item);
  const repoCoord = resolveRepoCoord(rootEvent, item);
  const isOwnRepository = repoCoord
    ? repoOwnerPubkey(repoCoord) === activeAccount?.pubkey
    : false;
  const isUnread = item.unreadEventIds.includes(event.id);
  const lastActive = useRelativeTime(event.created_at);
  const nevent = eventIdToNevent(item.rootId);
  const linkPath = buildNotificationLink(nevent, {
    ...item,
    unreadEventIds: isUnread ? [event.id] : [],
  });

  return (
    <li
      className={cn(
        "group transition-colors",
        isUnread
          ? "border-l-2 border-l-pink-500 bg-accent/30 hover:bg-accent/50"
          : "border-l-2 border-l-transparent hover:bg-accent/20",
      )}
    >
      <div className="flex items-start">
        <Link
          to={linkPath}
          className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3"
          onClick={() => isUnread && actions.markEventAsRead(event.id)}
        >
          <div className="w-2 shrink-0 pt-2.5">
            {isUnread && <div className="h-2 w-2 rounded-full bg-pink-500" />}
          </div>
          <UserAvatar pubkey={event.pubkey} size="md" noHoverCard />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-5">
              <UserName pubkey={event.pubkey} />{" "}
              <span className="text-muted-foreground">
                {activityVerb(event)}
              </span>{" "}
              <span
                className={cn(
                  isUnread
                    ? "font-medium text-foreground"
                    : "text-foreground/80",
                )}
              >
                {title}
              </span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {lastActive}
              </span>
              <span className="text-xs text-muted-foreground/40">&middot;</span>
              {resolved ? (
                <StatusIcon
                  status={resolved.status}
                  variant={
                    rootType === "patch"
                      ? "patch"
                      : rootType === "pr"
                        ? "pr"
                        : "issue"
                  }
                  className="h-4 w-4"
                />
              ) : (
                <RootTypeIcon type={rootType} compact={false} />
              )}
              {repoCoord && (
                <>
                  <span className="text-xs text-muted-foreground/40">
                    &middot;
                  </span>
                  <RepoBadge
                    coord={repoCoord}
                    repoNameOnly={isOwnRepository}
                    asSpan
                  />
                </>
              )}
            </div>
          </div>
        </Link>
        <div className="hidden shrink-0 items-center gap-1 self-center pr-3 md:group-hover:flex">
          {isUnread && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.markEventAsRead(event.id)}
              title="Mark activity as read"
            >
              <Eye className="mr-1 h-3 w-3" />
              Read
            </Button>
          )}
          {currentView === "inbox" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.markEventAsArchived(event.id)}
              title="Archive activity"
            >
              <Archive className="mr-1 h-3 w-3" />
              Archive
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
  resolvedMap,
}: {
  item: NotificationItem;
  actions: NotificationActions;
  compact?: boolean;
  currentView?: ViewTab;
  resolvedMap?: Map<string, ResolvedIssueLite>;
}) {
  // Always call hooks unconditionally — React rules of hooks.
  // useRootEvent is called inside ThreadNotificationRow, but we need to
  // dispatch before that. Social items have synthetic rootIds so we pass
  // through to the appropriate social row which doesn't call it.
  if (item.kind === "repo-star") {
    return (
      <SocialNotificationRow
        item={item as SocialNotificationItem}
        actions={actions}
        compact={compact}
        currentView={currentView}
      />
    );
  }
  if (item.kind === "repo-zap") {
    return (
      <RepoZapNotificationRow
        item={item as RepoZapNotificationItem}
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
      resolvedMap={resolvedMap}
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
