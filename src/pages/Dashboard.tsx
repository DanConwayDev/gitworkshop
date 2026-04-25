/**
 * Dashboard — shown to logged-in users on the root route.
 *
 * Desktop layout (md+):
 *   Left column (~65%):  Greeting → Notifications → Continue where you left off
 *   Right column (~35%): My repositories → Followed repositories
 *
 * Mobile layout (< md):
 *   Single column: Greeting → My repos → Followed repos → Notifications → Activity
 */

import { Link } from "react-router-dom";
import { nip19 } from "nostr-tools";
import {
  Bell,
  Plus,
  Eye,
  ArrowRight,
  Inbox,
  Check,
  Activity,
  ChevronDown,
  ChevronUp,
  Pin,
  Search,
} from "lucide-react";
import { CreateRepoDialog } from "@/components/CreateRepoDialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { ActivityFeed } from "@/components/ActivityFeed";
import { useUserActivity } from "@/hooks/useUserActivity";
import { useUserRepositories } from "@/hooks/useUserRepositories";
import { useUserFollowedRepos } from "@/hooks/useUserFollowedRepos";
import { useUserPinnedCoords } from "@/hooks/useUserPinnedRepos";
import { useNotifications } from "@/hooks/useNotifications";
import { useUserProfileSubscription } from "@/hooks/useUserProfileSubscription";
import { useUserPath } from "@/hooks/useUserPath";
import { useActiveAccount } from "applesauce-react/hooks";
import { useProfile } from "@/hooks/useProfile";

import { useState, useMemo } from "react";
import type { ResolvedRepo } from "@/lib/nip34";
import { NotificationRow } from "@/components/NotificationRow";

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
    <div className="mb-8">
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
// Repo rows
// ---------------------------------------------------------------------------

/**
 * Single-line row: [avatar] username / repo-name.
 * Used in both "My repositories" and "Followed repositories" panels.
 */
function RepoListItem({
  repo,
  isPinned,
  hideAuthor,
}: {
  repo: ResolvedRepo;
  isPinned?: boolean;
  hideAuthor?: boolean;
}) {
  const npub = nip19.npubEncode(repo.selectedMaintainer);
  const repoPath = `/${npub}/${repo.dTag}`;
  const name = repo.name || repo.dTag;

  return (
    <Link
      to={repoPath}
      className="group flex items-center gap-1.5 px-1.5 py-1 -mx-1.5 rounded-md hover:bg-muted/50 transition-colors min-w-0"
    >
      {isPinned && (
        <Pin className="h-3 w-3 text-muted-foreground/50 shrink-0 -rotate-45" />
      )}
      {!hideAuthor && (
        <>
          <UserAvatar
            pubkey={repo.selectedMaintainer}
            size="xs"
            className="h-3.5 w-3.5 shrink-0"
          />
          <UserName
            pubkey={repo.selectedMaintainer}
            className="text-xs text-muted-foreground shrink-0"
          />
          <span className="text-xs text-muted-foreground/40 shrink-0">/</span>
        </>
      )}
      <span className="text-sm font-medium truncate min-w-0 flex-1 group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
        {name}
      </span>
    </Link>
  );
}

function RepoRowSkeleton() {
  return (
    <div className="flex items-center gap-1.5 px-1.5 py-1">
      <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0" />
      <Skeleton className="h-3.5 w-32" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// My repositories panel
// ---------------------------------------------------------------------------

const INITIAL_VISIBLE = 15;

function MyRepositoriesPanel({ pubkey }: { pubkey: string }) {
  const repos = useUserRepositories(pubkey);
  const pinnedCoords = useUserPinnedCoords(pubkey);
  const userPath = useUserPath(pubkey);
  const [expanded, setExpanded] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [search, setSearch] = useState("");

  const pinnedSet = useMemo(() => new Set(pinnedCoords ?? []), [pinnedCoords]);

  const sorted = useMemo(
    () =>
      repos
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
        : undefined,
    [repos, pinnedCoords],
  );

  const trimmed = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!sorted) return undefined;
    if (!trimmed) return sorted;
    return sorted.filter(
      (r) =>
        r.name.toLowerCase().includes(trimmed) ||
        r.dTag.toLowerCase().includes(trimmed) ||
        r.description.toLowerCase().includes(trimmed),
    );
  }, [sorted, trimmed]);

  const isFiltering = trimmed.length > 0;
  const displayRepos =
    isFiltering || expanded ? filtered : filtered?.slice(0, INITIAL_VISIBLE);
  const hasMore = !isFiltering && (filtered?.length ?? 0) > INITIAL_VISIBLE;

  return (
    <div className="h-fit">
      <div className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">
            <Link
              to={`${userPath}?tab=repositories`}
              className="hover:text-pink-600 dark:hover:text-pink-400 transition-colors"
            >
              My repositories
            </Link>
          </h3>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            New
          </Button>
        </div>
      </div>

      {sorted && sorted.length > 0 && (
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Filter repositories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm bg-background/60 focus-visible:ring-pink-500/30"
          />
        </div>
      )}

      <div>
        {repos === undefined ? (
          <div className="space-y-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <RepoRowSkeleton key={i} />
            ))}
          </div>
        ) : displayRepos && displayRepos.length > 0 ? (
          <>
            <div className="space-y-0.5">
              {displayRepos.map((repo) => {
                const coord = `30617:${repo.selectedMaintainer}:${repo.dTag}`;
                return (
                  <RepoListItem
                    key={coord}
                    repo={repo}
                    isPinned={pinnedSet.has(coord)}
                    hideAuthor
                  />
                );
              })}
            </div>
            {hasMore && (
              <div className="mt-3 pt-2 border-t border-border/40">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs text-muted-foreground"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? (
                    <>
                      Show less
                      <ChevronUp className="h-3 w-3 ml-1.5" />
                    </>
                  ) : (
                    <>
                      Show all {filtered?.length} repositories
                      <ChevronDown className="h-3 w-3 ml-1.5" />
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        ) : isFiltering ? (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No repositories match "{search}"
            </p>
          </div>
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
      </div>

      <CreateRepoDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Followed repos panel
// ---------------------------------------------------------------------------

function FollowedReposPanel({ pubkey }: { pubkey: string }) {
  const repos = useUserFollowedRepos(pubkey);
  const userPath = useUserPath(pubkey);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");

  const sorted = useMemo(
    () =>
      repos ? [...repos].sort((a, b) => b.updatedAt - a.updatedAt) : undefined,
    [repos],
  );

  const trimmed = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!sorted) return undefined;
    if (!trimmed) return sorted;
    return sorted.filter(
      (r) =>
        r.name.toLowerCase().includes(trimmed) ||
        r.dTag.toLowerCase().includes(trimmed) ||
        r.description.toLowerCase().includes(trimmed),
    );
  }, [sorted, trimmed]);

  const isFiltering = trimmed.length > 0;
  const displayRepos =
    isFiltering || expanded ? filtered : filtered?.slice(0, INITIAL_VISIBLE);
  const hasMore = !isFiltering && (filtered?.length ?? 0) > INITIAL_VISIBLE;

  return (
    <div className="h-fit">
      <div className="pb-3">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <Link
            to={`${userPath}?tab=followed`}
            className="hover:text-pink-600 dark:hover:text-pink-400 transition-colors"
          >
            Followed repositories
          </Link>
        </h3>
      </div>

      {sorted && sorted.length > 0 && (
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Filter repositories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm bg-background/60 focus-visible:ring-pink-500/30"
          />
        </div>
      )}

      <div>
        {repos === undefined ? (
          <div className="space-y-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <RepoRowSkeleton key={i} />
            ))}
          </div>
        ) : displayRepos && displayRepos.length > 0 ? (
          <>
            <div className="space-y-0.5">
              {displayRepos.map((repo) => {
                const coord = `30617:${repo.selectedMaintainer}:${repo.dTag}`;
                return <RepoListItem key={coord} repo={repo} />;
              })}
            </div>
            {hasMore && (
              <div className="mt-3 pt-2 border-t border-border/40">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs text-muted-foreground"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? (
                    <>
                      Show less
                      <ChevronUp className="h-3 w-3 ml-1.5" />
                    </>
                  ) : (
                    <>
                      Show all {filtered?.length} repositories
                      <ChevronDown className="h-3 w-3 ml-1.5" />
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        ) : isFiltering ? (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No repositories match "{search}"
            </p>
          </div>
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embedded notifications panel (compact, inbox only, max 5)
// ---------------------------------------------------------------------------

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
    <div>
      <div className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold flex items-center gap-2">
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
          </h3>
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
      </div>
      <div>
        {!inboxItems || (inboxItems.length === 0 && history.loading) ? (
          <div className="space-y-3 py-2">
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
          <div className="py-8 text-center">
            <Inbox className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Your inbox is empty</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border/30">
              {inboxItems.map((item) => (
                <NotificationRow
                  key={item.rootId}
                  item={item}
                  actions={actions}
                  compact
                  currentView="inbox"
                />
              ))}
            </ul>
            {hasMore && (
              <div className="pt-2">
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Continue where you left off" — expanded by default
// ---------------------------------------------------------------------------

function RecentActivitySection({ pubkey }: { pubkey: string }) {
  const events = useUserActivity(pubkey);

  // Only show if there's something to show
  if (events !== undefined && events.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-muted-foreground/60" />
        <span className="text-sm font-medium text-muted-foreground">
          Continue where you left off
        </span>
        {events && events.length > 0 && (
          <span className="text-xs text-muted-foreground/50 ml-1">
            ({events.length} recent items)
          </span>
        )}
      </div>

      <div className="pl-6 border-l border-border/40">
        <ActivityFeed events={events} pageUserPubkey={pubkey} limit={15} />
      </div>
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
      <div className="container max-w-screen-xl px-4 md:px-8 py-10 md:py-14">
        {/* Mobile: greeting at top */}
        <div className="md:hidden">
          <GreetingHeader pubkey={pubkey} />
        </div>

        {/* Two-column layout on desktop */}
        <div className="flex flex-col md:flex-row gap-8">
          {/* ---- Left column: greeting (desktop) + notifications + activity ---- */}
          <div className="order-2 md:order-1 flex-1 min-w-0 space-y-8">
            {/* Desktop-only greeting */}
            <div className="hidden md:block">
              <GreetingHeader pubkey={pubkey} />
            </div>

            <NotificationsPanel />

            <RecentActivitySection pubkey={pubkey} />
          </div>

          {/* ---- Right column: repo quick-links ---- */}
          <div className="order-1 md:order-2 w-full md:w-80 lg:w-96 md:max-w-sm shrink-0 space-y-6">
            <MyRepositoriesPanel pubkey={pubkey} />
            <Separator className="opacity-40" />
            <FollowedReposPanel pubkey={pubkey} />
          </div>
        </div>
      </div>
    </div>
  );
}
