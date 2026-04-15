/**
 * Dashboard — shown to logged-in users on the root route.
 *
 * Layout:
 *   - Slim notification banner (full width, conditional)
 *   - Two-column on desktop, stacked on mobile:
 *     Left (wider):  Activity feed from followed repos + followed authors
 *     Right (narrower): My repositories + Followed repos
 */

import { Link } from "react-router-dom";
import {
  Bell,
  Plus,
  GitBranch,
  Activity,
  Eye,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityFeed } from "@/components/ActivityFeed";
import { useUserActivity } from "@/hooks/useUserActivity";
import { useUserRepositories } from "@/hooks/useUserRepositories";
import { useUserFollowedRepos } from "@/hooks/useUserFollowedRepos";
import { useUserPinnedCoords } from "@/hooks/useUserPinnedRepos";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { useUserProfileSubscription } from "@/hooks/useUserProfileSubscription";
import { useRepoPath } from "@/hooks/useRepoPath";
import { UserLink } from "@/components/UserAvatar";
import { useActiveAccount } from "applesauce-react/hooks";
import { formatDistanceToNow } from "date-fns";
import type { ResolvedRepo } from "@/lib/nip34";

// ---------------------------------------------------------------------------
// Notification banner
// ---------------------------------------------------------------------------

function NotificationBanner({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <Link
      to="/notifications"
      className="block w-full bg-pink-500/10 border-b border-pink-500/20 hover:bg-pink-500/15 transition-colors"
    >
      <div className="container max-w-screen-xl px-4 md:px-8 py-2.5 flex items-center gap-2">
        <Bell className="h-4 w-4 text-pink-500 shrink-0" />
        <span className="text-sm font-medium text-pink-600 dark:text-pink-400">
          {count} unread notification{count !== 1 ? "s" : ""}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-pink-500 ml-auto" />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// My repositories panel
// ---------------------------------------------------------------------------

function RepoRow({ repo }: { repo: ResolvedRepo }) {
  const repoPath = useRepoPath(repo.selectedMaintainer, repo.dTag, repo.relays);
  const timeAgo = formatDistanceToNow(new Date(repo.updatedAt * 1000), {
    addSuffix: true,
  });

  return (
    <Link
      to={repoPath}
      className="group flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/60 transition-colors -mx-3"
    >
      <div className="p-1.5 rounded-md bg-gradient-to-br from-pink-500/10 to-pink-500/5 shrink-0">
        <GitBranch className="h-3.5 w-3.5 text-pink-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
          {repo.name}
        </p>
        {repo.description && (
          <p className="text-xs text-muted-foreground truncate">
            {repo.description}
          </p>
        )}
      </div>
      <span className="text-[10px] text-muted-foreground/60 shrink-0">
        {timeAgo}
      </span>
    </Link>
  );
}

function RepoRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3">
      <Skeleton className="h-7 w-7 rounded-md shrink-0" />
      <div className="flex-1 space-y-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-3 w-12 shrink-0" />
    </div>
  );
}

interface MyRepositoriesPanelProps {
  pubkey: string;
}

function MyRepositoriesPanel({ pubkey }: MyRepositoriesPanelProps) {
  const repos = useUserRepositories(pubkey);
  const pinnedCoords = useUserPinnedCoords(pubkey);

  // Sort: pinned first (by pin order), then by updatedAt desc
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

  const displayRepos = sorted?.slice(0, 8);

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-pink-500" />
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
      <CardContent className="px-4 pb-4">
        {repos === undefined ? (
          <div className="space-y-0.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <RepoRowSkeleton key={i} />
            ))}
          </div>
        ) : displayRepos && displayRepos.length > 0 ? (
          <>
            <div className="space-y-0.5">
              {displayRepos.map((repo) => (
                <RepoRow
                  key={`${repo.selectedMaintainer}:${repo.dTag}`}
                  repo={repo}
                />
              ))}
            </div>
            {sorted && sorted.length > 8 && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs text-muted-foreground"
                  asChild
                >
                  <Link to={`/search`}>
                    View all {sorted.length} repositories
                    <ArrowRight className="h-3 w-3 ml-1.5" />
                  </Link>
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="py-6 text-center">
            <GitBranch className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground mb-3">
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

function FollowedRepoRow({ repo }: { repo: ResolvedRepo }) {
  const repoPath = useRepoPath(repo.selectedMaintainer, repo.dTag, repo.relays);
  const timeAgo = formatDistanceToNow(new Date(repo.updatedAt * 1000), {
    addSuffix: true,
  });

  return (
    <Link
      to={repoPath}
      className="group flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/60 transition-colors -mx-3"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <p className="text-sm font-medium truncate group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
            {repo.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-muted-foreground/60">{timeAgo}</span>
        {repo.webUrls.length > 0 && (
          <ExternalLink className="h-3 w-3 text-muted-foreground/30 group-hover:text-pink-500 transition-colors" />
        )}
      </div>
    </Link>
  );
}

interface FollowedReposPanelProps {
  pubkey: string;
}

function FollowedReposPanel({ pubkey }: FollowedReposPanelProps) {
  const repos = useUserFollowedRepos(pubkey);

  // Sort by most recently updated
  const sorted = repos
    ? [...repos].sort((a, b) => b.updatedAt - a.updatedAt)
    : undefined;

  const displayRepos = sorted?.slice(0, 8);

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Eye className="h-4 w-4 text-pink-500" />
          Followed repositories
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {repos === undefined ? (
          <div className="space-y-0.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <RepoRowSkeleton key={i} />
            ))}
          </div>
        ) : displayRepos && displayRepos.length > 0 ? (
          <>
            <div className="space-y-0.5">
              {displayRepos.map((repo) => (
                <FollowedRepoRow
                  key={`${repo.selectedMaintainer}:${repo.dTag}`}
                  repo={repo}
                />
              ))}
            </div>
            {sorted && sorted.length > 8 && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <p className="text-xs text-muted-foreground text-center">
                  +{sorted.length - 8} more followed repositories
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="py-6 text-center">
            <Eye className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground mb-1">
              No followed repositories
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              Follow repos to track their activity here
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Activity feed panel
// ---------------------------------------------------------------------------

interface ActivityPanelProps {
  pubkey: string;
}

function ActivityPanel({ pubkey }: ActivityPanelProps) {
  const events = useUserActivity(pubkey);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-pink-500" />
        <h2 className="text-sm font-semibold">Recent activity</h2>
        {events && events.length > 0 && (
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-auto">
            {events.length}
          </Badge>
        )}
      </div>
      <ActivityFeed events={events} pageUserPubkey={pubkey} limit={30} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function Dashboard() {
  const account = useActiveAccount();
  const pubkey = account?.pubkey;

  // Subscribe to the current user's profile data (kind:0, kind:3, kind:10002,
  // kind:10017, kind:10018) so the activity feed and repo lists are populated.
  useUserProfileSubscription(pubkey);

  const unreadCount = useUnreadNotificationCount();

  if (!pubkey) return null;

  return (
    <div className="min-h-full">
      {/* Notification banner */}
      <NotificationBanner count={unreadCount} />

      {/* Main content */}
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 xl:gap-8">
          {/* Left: activity feed */}
          <div className="min-w-0">
            <ActivityPanel pubkey={pubkey} />
          </div>

          {/* Right: my repos + followed repos */}
          <div className="space-y-4">
            <MyRepositoriesPanel pubkey={pubkey} />
            <FollowedReposPanel pubkey={pubkey} />
          </div>
        </div>
      </div>
    </div>
  );
}
