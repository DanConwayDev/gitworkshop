/**
 * Dashboard — shown to logged-in users on the root route.
 *
 * Layout (top → bottom):
 *   1. Greeting header
 *   2. Quick-launch: My repositories + Followed repositories (side by side)
 *   3. Notifications panel (compact, inbox only, max 5 items)
 *   4. "Continue where you left off" — recent personal activity (subtle, limited)
 */

import { Link } from "react-router-dom";
import {
  Bell,
  Plus,
  Eye,
  ArrowRight,
  Inbox,
  Archive,
  Check,
  CircleDot,
  GitPullRequest,
  GitCommitHorizontal,
  MessageCircle,
  GitMerge,
  XCircle,
  Star,
  Activity,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ActivityFeed } from "@/components/ActivityFeed";
import { useUserActivity } from "@/hooks/useUserActivity";
import { useUserRepositories } from "@/hooks/useUserRepositories";
import { useUserFollowedRepos } from "@/hooks/useUserFollowedRepos";
import { useUserPinnedCoords } from "@/hooks/useUserPinnedRepos";
import {
  useNotifications,
  type NotificationActions,
} from "@/hooks/useNotifications";
import { useUserProfileSubscription } from "@/hooks/useUserProfileSubscription";
import { useRepoPath } from "@/hooks/useRepoPath";
import { UserLink } from "@/components/UserAvatar";
import { UserAvatar } from "@/components/UserAvatar";
import { RepoBadge } from "@/components/RepoBadge";
import { useActiveAccount } from "applesauce-react/hooks";
import { useProfile } from "@/hooks/useProfile";

import { eventIdToNevent } from "@/lib/routeUtils";
import { eventStore, eventLoader } from "@/services/nostr";
import { use$ } from "@/hooks/use$";
import { cn } from "@/lib/utils";
import { useState, useEffect, useMemo } from "react";
import type { ResolvedRepo } from "@/lib/nip34";
import type {
  NotificationItem,
  SocialNotificationItem,
} from "@/lib/notifications";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  COMMENT_KIND,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_OPEN,
  STATUS_DRAFT,
  PR_UPDATE_KIND,
} from "@/lib/nip34";

// ---------------------------------------------------------------------------
// Greeting header
// ---------------------------------------------------------------------------

function GreetingHeader({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  const name = profile?.displayName ?? profile?.name;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="mb-10">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        {greeting}
        {name ? `, ${name.split(" ")[0]}` : ""}
      </h1>
      <p className="text-muted-foreground mt-1">
        Here's what's happening in your world.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Repo list — clean, name-only rows
// ---------------------------------------------------------------------------

function RepoNameRow({ repo }: { repo: ResolvedRepo }) {
  const repoPath = useRepoPath(repo.selectedMaintainer, repo.dTag, repo.relays);

  return (
    <Link
      to={repoPath}
      className="group flex items-center py-2.5 rounded-lg hover:bg-muted/50 transition-colors px-2 -mx-2"
    >
      <span className="text-sm font-medium truncate group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
        {repo.name}
      </span>
    </Link>
  );
}

function RepoNameRowSkeleton() {
  return (
    <div className="py-2.5 px-2">
      <Skeleton className="h-4 w-36" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// My repositories panel
// ---------------------------------------------------------------------------

function MyRepositoriesPanel({ pubkey }: { pubkey: string }) {
  const repos = useUserRepositories(pubkey);
  const pinnedCoords = useUserPinnedCoords(pubkey);

  const sorted = repos
    ? [...repos].sort((a, b) => {
        const aCoord = `30617:${a.selectedMaintainer}:${a.dTag}`;
        const bCoord = `30617:${b.selectedMaintainer}:${b.dTag}`;
        const aPin = pinnedCoords?.indexOf(aCoord) ?? -1;
        const bPin = pinnedCoords?.indexOf(bCoord) ?? -1;
        if (aPin !== -1 && bPin !== -1) return aPin - bPin;
        if (aPin !== -1) return -1;
        if (bPin !== -1) return 1;
        return b.updatedAt - a.updatedAt;
      })
    : undefined;

  const displayRepos = sorted?.slice(0, 6);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            My repositories
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            asChild
          >
            <Link to="/new">
              <Plus className="h-3.5 w-3.5 mr-1" />
              New
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {repos === undefined ? (
          <div className="space-y-0">
            {Array.from({ length: 4 }).map((_, i) => (
              <RepoNameRowSkeleton key={i} />
            ))}
          </div>
        ) : displayRepos && displayRepos.length > 0 ? (
          <>
            <div className="space-y-0">
              {displayRepos.map((repo) => (
                <RepoNameRow
                  key={`${repo.selectedMaintainer}:${repo.dTag}`}
                  repo={repo}
                />
              ))}
            </div>
            {sorted && sorted.length > 6 && (
              <div className="mt-4 pt-3 border-t border-border/40">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs text-muted-foreground"
                  asChild
                >
                  <Link to="/search">
                    View all {sorted.length} repositories
                    <ArrowRight className="h-3 w-3 ml-1.5" />
                  </Link>
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              No repositories yet
            </p>
            <Button size="sm" variant="outline" asChild className="text-xs">
              <Link to="/ngit">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Publish with ngit
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Followed repos panel
// ---------------------------------------------------------------------------

function FollowedRepoNameRow({ repo }: { repo: ResolvedRepo }) {
  const repoPath = useRepoPath(repo.selectedMaintainer, repo.dTag, repo.relays);

  return (
    <Link
      to={repoPath}
      className="group flex items-center gap-2 py-2.5 rounded-lg hover:bg-muted/50 transition-colors px-2 -mx-2"
    >
      <span className="text-sm font-medium truncate group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors flex-1 min-w-0">
        {repo.name}
      </span>
      <div className="shrink-0">
        {repo.maintainerSet.slice(0, 1).map((pk) => (
          <UserLink
            key={pk}
            pubkey={pk}
            avatarSize="xs"
            nameClassName="text-[10px] text-muted-foreground"
            noLink
          />
        ))}
      </div>
    </Link>
  );
}

function FollowedReposPanel({ pubkey }: { pubkey: string }) {
  const repos = useUserFollowedRepos(pubkey);

  const sorted = repos
    ? [...repos].sort((a, b) => b.updatedAt - a.updatedAt)
    : undefined;

  const displayRepos = sorted?.slice(0, 6);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          Followed repositories
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {repos === undefined ? (
          <div className="space-y-0">
            {Array.from({ length: 4 }).map((_, i) => (
              <RepoNameRowSkeleton key={i} />
            ))}
          </div>
        ) : displayRepos && displayRepos.length > 0 ? (
          <>
            <div className="space-y-0">
              {displayRepos.map((repo) => (
                <FollowedRepoNameRow
                  key={`${repo.selectedMaintainer}:${repo.dTag}`}
                  repo={repo}
                />
              ))}
            </div>
            {sorted && sorted.length > 6 && (
              <div className="mt-4 pt-3 border-t border-border/40">
                <p className="text-xs text-muted-foreground text-center">
                  +{sorted.length - 6} more followed repositories
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center">
            <Eye className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground mb-1">
              No followed repositories
            </p>
            <p className="text-xs text-muted-foreground/60">
              Follow repos to track their activity here
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Embedded notifications panel (compact, inbox only, max 5)
// ---------------------------------------------------------------------------

function inferRootType(
  item: NotificationItem,
): "issue" | "pr" | "patch" | "unknown" {
  for (const ev of item.events) {
    if (ev.kind === ISSUE_KIND) return "issue";
    if (ev.kind === PR_KIND) return "pr";
    if (ev.kind === PATCH_KIND) return "patch";
  }
  for (const ev of item.events) {
    const kTag = ev.tags.find(([t]) => t === "K")?.[1];
    if (kTag === String(ISSUE_KIND)) return "issue";
    if (kTag === String(PR_KIND)) return "pr";
    if (kTag === String(PATCH_KIND)) return "patch";
  }
  return "unknown";
}

function CompactNotifIcon({
  type,
}: {
  type: "issue" | "pr" | "patch" | "unknown";
}) {
  switch (type) {
    case "issue":
      return <CircleDot className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    case "pr":
      return <GitPullRequest className="h-3.5 w-3.5 text-pink-500 shrink-0" />;
    case "patch":
      return (
        <GitCommitHorizontal className="h-3.5 w-3.5 text-pink-500 shrink-0" />
      );
    default:
      return (
        <MessageCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      );
  }
}

function useRootEventForNotif(rootId: string) {
  const isEventId = rootId.length === 64;
  const rootEvents = use$(() => {
    if (!isEventId) return undefined;
    return eventStore.timeline([{ ids: [rootId] }]);
  }, [rootId, isEventId]);

  useEffect(() => {
    if (isEventId && (!rootEvents || rootEvents.length === 0)) {
      eventLoader({ id: rootId }).subscribe();
    }
  }, [rootId, isEventId, rootEvents]);

  return rootEvents?.[0];
}

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
  const firstLine = ev.content.split("\n")[0];
  if (firstLine) return firstLine.slice(0, 80);
  return undefined;
}

function buildUnreadText(item: NotificationItem): string | undefined {
  if (!item.unread || item.unreadEventIds.length === 0) return undefined;
  const unreadIdSet = new Set(item.unreadEventIds);
  const unreadEvents = item.events.filter((ev) => unreadIdSet.has(ev.id));

  let commentCount = 0;
  let merged = false;
  let closed = false;
  let reopened = false;
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
      // drafted — no separate flag needed
    } else if (ev.kind === PR_UPDATE_KIND) {
      newRevision = true;
    }
  }

  const parts: string[] = [];
  if (merged) parts.push("merged");
  else if (closed) parts.push("closed");
  else if (reopened) parts.push("reopened");
  if (newRevision) parts.push("new revision");
  if (commentCount > 0)
    parts.push(
      `${commentCount} new ${commentCount === 1 ? "comment" : "comments"}`,
    );

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function buildNotifLink(nevent: string, item: NotificationItem): string {
  const base = `/${nevent}`;
  if (item.unreadEventIds.length === 0) return base;
  const anchors = item.unreadEventIds.map((id) => id.slice(0, 15));
  const params = new URLSearchParams({ unread: anchors.join(",") });
  return `${base}?${params.toString()}#${anchors[0]}`;
}

function CompactSocialNotifRow({
  item,
  actions,
}: {
  item: SocialNotificationItem;
  actions: NotificationActions;
}) {
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

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors cursor-default",
        item.unread
          ? "bg-accent/20 border-l-2 border-l-pink-500"
          : "border-l-2 border-l-transparent",
      )}
      onClick={() => actions.markAsRead(item.rootId)}
    >
      {item.unread && (
        <div className="h-1.5 w-1.5 rounded-full bg-pink-500 shrink-0" />
      )}
      {!item.unread && <div className="h-1.5 w-1.5 shrink-0" />}
      <Star className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
      <div className="flex items-center gap-1 flex-1 min-w-0">
        {actorPubkeys.slice(0, 3).map((pk) => (
          <UserAvatar
            key={pk}
            pubkey={pk}
            size="sm"
            className="h-4 w-4 text-[8px]"
          />
        ))}
        <span className="text-sm text-muted-foreground ml-1">starred</span>
        {item.repoCoord && <RepoBadge coord={item.repoCoord} repoNameOnly />}
      </div>
    </li>
  );
}

function CompactThreadNotifRow({
  item,
  actions,
}: {
  item: NotificationItem;
  actions: NotificationActions;
}) {
  const rootEvent = useRootEventForNotif(item.rootId);

  const rootType = inferRootType(item);
  let title = "";
  if (rootEvent) {
    title = titleFromEvent(rootEvent) ?? "";
  }
  if (!title) {
    for (const ev of item.events) {
      const t = titleFromEvent(ev);
      if (t) {
        title = t;
        break;
      }
    }
  }
  if (!title) title = `Activity on ${item.rootId.slice(0, 8)}...`;

  const repoCoord = (() => {
    if (rootEvent) {
      const aTag = rootEvent.tags.find(([t]) => t === "a")?.[1];
      if (aTag?.startsWith("30617:")) return aTag;
    }
    for (const ev of item.events) {
      const aTag = ev.tags.find(([t]) => t === "a")?.[1];
      if (aTag?.startsWith("30617:")) return aTag;
    }
    return undefined;
  })();

  const unreadText = buildUnreadText(item);
  const nevent = eventIdToNevent(item.rootId);
  const linkPath = buildNotifLink(nevent, item);

  const hasMerge =
    item.unreadEventIds.length > 0 &&
    item.events.some(
      (ev) =>
        new Set(item.unreadEventIds).has(ev.id) && ev.kind === STATUS_RESOLVED,
    );
  const hasClosed =
    item.unreadEventIds.length > 0 &&
    item.events.some(
      (ev) =>
        new Set(item.unreadEventIds).has(ev.id) && ev.kind === STATUS_CLOSED,
    );

  const UnreadIcon = hasMerge ? GitMerge : hasClosed ? XCircle : MessageCircle;
  const unreadIconColor = hasMerge
    ? "text-pink-500"
    : hasClosed
      ? "text-red-500"
      : "text-muted-foreground";

  return (
    <li
      className={cn(
        "group transition-colors",
        item.unread
          ? "bg-accent/20 border-l-2 border-l-pink-500"
          : "border-l-2 border-l-transparent",
      )}
    >
      <Link
        to={linkPath}
        className="flex items-center gap-3 px-4 py-3 min-w-0"
        onClick={() => actions.markAsRead(item.rootId)}
      >
        {item.unread ? (
          <div className="h-1.5 w-1.5 rounded-full bg-pink-500 shrink-0" />
        ) : (
          <div className="h-1.5 w-1.5 shrink-0" />
        )}
        <CompactNotifIcon type={rootType} />
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm truncate",
              item.unread
                ? "font-medium text-foreground"
                : "text-foreground/80",
            )}
          >
            {title.length > 60 ? `${title.slice(0, 57)}...` : title}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {repoCoord && <RepoBadge coord={repoCoord} repoNameOnly />}
            {unreadText && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs",
                  item.unread
                    ? "text-pink-600 dark:text-pink-400 font-medium"
                    : "text-muted-foreground",
                )}
              >
                <UnreadIcon className={cn("h-3 w-3", unreadIconColor)} />
                {unreadText}
              </span>
            )}
          </div>
        </div>
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
      </Link>
    </li>
  );
}

function CompactNotifRow({
  item,
  actions,
}: {
  item: NotificationItem;
  actions: NotificationActions;
}) {
  if (item.kind !== "thread") {
    return (
      <CompactSocialNotifRow
        item={item as SocialNotificationItem}
        actions={actions}
      />
    );
  }
  return <CompactThreadNotifRow item={item} actions={actions} />;
}

const NOTIF_LIMIT = 5;

function NotificationsPanel() {
  const { items, unreadCount, actions, history } = useNotifications();

  const inboxItems = useMemo(
    () => items?.filter((item) => !item.archived).slice(0, NOTIF_LIMIT),
    [items],
  );

  const hasMore =
    (items?.filter((item) => !item.archived).length ?? 0) > NOTIF_LIMIT;

  return (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            Notifications
            {unreadCount > 0 && (
              <Badge
                variant="secondary"
                className="h-5 min-w-[20px] px-1.5 text-xs bg-pink-500/15 text-pink-600 dark:text-pink-400 border-0"
              >
                {unreadCount}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={actions.markAllAsRead}
              >
                <Check className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              asChild
            >
              <Link to="/notifications">
                View all
                <ArrowRight className="h-3 w-3 ml-1" />
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {!inboxItems || (inboxItems.length === 0 && history.loading) ? (
          <div className="px-5 space-y-3 py-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3.5 w-3.5 rounded shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
            ))}
          </div>
        ) : inboxItems.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Inbox className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Your inbox is empty</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border/30">
              {inboxItems.map((item) => (
                <CompactNotifRow
                  key={item.rootId}
                  item={item}
                  actions={actions}
                />
              ))}
            </ul>
            {hasMore && (
              <div className="px-4 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs text-muted-foreground"
                  asChild
                >
                  <Link to="/notifications">
                    View all notifications
                    <ArrowRight className="h-3 w-3 ml-1.5" />
                  </Link>
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// "Continue where you left off" — collapsible activity summary
// ---------------------------------------------------------------------------

function RecentActivitySection({ pubkey }: { pubkey: string }) {
  const events = useUserActivity(pubkey);
  const [expanded, setExpanded] = useState(false);

  // Only show if there's something to show
  if (events !== undefined && events.length === 0) return null;

  return (
    <div>
      <button
        className="flex items-center gap-2 group mb-0 w-full text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <Activity className="h-4 w-4 text-muted-foreground/60 group-hover:text-muted-foreground transition-colors" />
        <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
          Continue where you left off
        </span>
        {events && events.length > 0 && (
          <span className="text-xs text-muted-foreground/50 ml-1">
            ({events.length} recent items)
          </span>
        )}
        <span className="ml-auto text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="mt-4 pl-6 border-l border-border/40">
          <ActivityFeed events={events} pageUserPubkey={pubkey} limit={15} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function Dashboard() {
  const account = useActiveAccount();
  const pubkey = account?.pubkey;

  useUserProfileSubscription(pubkey);

  if (!pubkey) return null;

  return (
    <div className="min-h-full">
      <div className="container max-w-screen-xl px-4 md:px-8 py-10 md:py-14 space-y-10">
        {/* Greeting */}
        <GreetingHeader pubkey={pubkey} />

        {/* Quick-launch: my repos + followed repos */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-4">
            Your repositories
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 xl:gap-6">
            <MyRepositoriesPanel pubkey={pubkey} />
            <FollowedReposPanel pubkey={pubkey} />
          </div>
        </section>

        {/* Notifications */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-4">
            Inbox
          </h2>
          <NotificationsPanel />
        </section>

        {/* Recent personal activity — collapsed by default */}
        <section className="pb-6">
          <RecentActivitySection pubkey={pubkey} />
        </section>
      </div>
    </div>
  );
}
