import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { nip19 } from "nostr-tools";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useProfile } from "@/hooks/useProfile";
import { useLoadProfile } from "@/hooks/useLoadProfile";
import { useUserRepositories } from "@/hooks/useUserRepositories";
import { useUserProfileSubscription } from "@/hooks/useUserProfileSubscription";
import { useUserFollowedRepos } from "@/hooks/useUserFollowedRepos";
import { useUserGitAuthorFollows } from "@/hooks/useUserGitAuthorFollows";
import { useUserStarredRepos } from "@/hooks/useUserStarredRepos";
import { useUserActivity } from "@/hooks/useUserActivity";
import { usePrefetchNip05 } from "@/hooks/usePrefetchNip05";
import { useRepoPath } from "@/hooks/useRepoPath";
import { ActivityFeed } from "@/components/ActivityFeed";
import { useIsFollowing } from "@/hooks/useIsFollowing";
import { useIsGitAuthorFollowing } from "@/hooks/useIsGitAuthorFollowing";
import { useRobustFollowActions } from "@/hooks/useRobustFollowActions";
import { useRobustGitAuthorFollowActions } from "@/hooks/useRobustGitAuthorFollowActions";
import { useRobustPinnedRepoActions } from "@/hooks/useRobustPinnedRepoActions";
import {
  useUserPinnedRepos,
  useUserPinnedCoords,
} from "@/hooks/useUserPinnedRepos";
import { useToast } from "@/hooks/useToast";
import { UserAvatar, UserLink, UserName } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GitBranch,
  ExternalLink,
  Globe,
  Zap,
  Copy,
  Check,
  ArrowLeft,
  UserPlus,
  UserMinus,
  Loader2,
  Star,
  Users,
  Eye,
  Activity,
  MoreHorizontal,
  Pin,
  PinOff,
  GripVertical,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useState, useCallback, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveAccount } from "applesauce-react/hooks";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ResolvedRepo } from "@/lib/nip34";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface UserPageProps {
  pubkey: string;
}

type TabId =
  | "activity"
  | "repositories"
  | "followed"
  | "starred"
  | "git-follows";

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  {
    id: "activity",
    label: "Activity",
    icon: <Activity className="h-3.5 w-3.5" />,
  },
  {
    id: "repositories",
    label: "Repositories",
    icon: <GitBranch className="h-3.5 w-3.5" />,
  },
  {
    id: "followed",
    label: "Followed",
    icon: <Eye className="h-3.5 w-3.5" />,
  },
  {
    id: "starred",
    label: "Starred",
    icon: <Star className="h-3.5 w-3.5" />,
  },
  {
    id: "git-follows",
    label: "Followed Authors",
    icon: <Users className="h-3.5 w-3.5" />,
  },
];

export default function UserPage({ pubkey }: UserPageProps) {
  useLoadProfile(pubkey);
  const profile = useProfile(pubkey);
  const repos = useUserRepositories(pubkey);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabId | null) ?? "activity";

  const setTab = (tab: TabId) => {
    setSearchParams(tab === "activity" ? {} : { tab });
  };

  // Subscribe to this user's replaceable events (kind 0, 3, 10002, 10017,
  // 10018) for the duration of the profile page visit. No-op for own profile.
  useUserProfileSubscription(pubkey);

  // Reactive data for tabs
  const activity = useUserActivity(pubkey);
  const followedRepos = useUserFollowedRepos(pubkey);
  const gitAuthorFollows = useUserGitAuthorFollows(pubkey);
  const starredRepos = useUserStarredRepos(pubkey);
  const pinnedCoords = useUserPinnedCoords(pubkey);
  const pinnedRepos = useUserPinnedRepos(pubkey);

  // Prefetch NIP-05 identity so useRepoPath resolves it from IDB on next visit
  usePrefetchNip05([pubkey]);
  const npub = nip19.npubEncode(pubkey);
  const account = useActiveAccount();
  const isOwnProfile = !!account && account.pubkey === pubkey;

  const displayName =
    profile?.displayName ?? profile?.name ?? npub.slice(0, 16) + "...";

  useSeoMeta({
    title: profile ? `${displayName} - ngit` : "User Profile - ngit",
    description: profile?.about ?? "Nostr user profile",
  });

  return (
    <div className="min-h-full">
      {/* Profile header */}
      <div className="relative isolate border-b border-border/40">
        {/* Banner */}
        {profile?.banner ? (
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <img
              src={profile.banner}
              alt=""
              className="w-full h-full object-cover opacity-15 dark:opacity-10"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
          </div>
        ) : (
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-pink-500/5 via-transparent to-pink-500/5" />
        )}

        <div className="container max-w-screen-xl px-4 md:px-8 py-8">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All repositories
          </Link>

          <div className="flex flex-col md:flex-row gap-6 md:gap-8">
            {/* Avatar */}
            <div className="shrink-0">
              {profile ? (
                <UserAvatar
                  pubkey={pubkey}
                  size="xl"
                  className="ring-4 ring-background shadow-xl"
                />
              ) : (
                <Skeleton className="h-20 w-20 md:h-24 md:w-24 rounded-full" />
              )}
            </div>

            {/* Profile info */}
            <div className="flex-1 min-w-0">
              {profile ? (
                <>
                  <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">
                    {displayName}
                  </h1>

                  {profile.name &&
                    profile.displayName &&
                    profile.name !== profile.displayName && (
                      <p className="text-muted-foreground text-sm mb-2">
                        @{profile.name}
                      </p>
                    )}

                  {profile.about && (
                    <p className="text-muted-foreground max-w-2xl mb-4 leading-relaxed">
                      {profile.about}
                    </p>
                  )}

                  <div className="flex items-center gap-4 flex-wrap">
                    {profile.nip05 && (
                      <span className="text-sm text-pink-600 dark:text-pink-400 font-medium">
                        {profile.nip05}
                      </span>
                    )}

                    {profile.website && (
                      <a
                        href={
                          profile.website.startsWith("http")
                            ? profile.website
                            : `https://${profile.website}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Globe className="h-3.5 w-3.5" />
                        {profile.website
                          .replace(/^https?:\/\//, "")
                          .replace(/\/$/, "")}
                      </a>
                    )}

                    {(profile.lud16 || profile.lud06) && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-amber-500">
                        <Zap className="h-3.5 w-3.5" />
                        Lightning
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-96" />
                  <div className="flex gap-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
              )}

              {/* Npub copy + follow buttons */}
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <CopyNpub npub={npub} />
                <GitAuthorFollowButton pubkey={pubkey} />
                <FollowButton pubkey={pubkey} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs nav */}
      <div className="border-b border-border/60">
        <div className="container max-w-screen-xl px-4 md:px-8">
          <TabsNav
            activeTab={activeTab}
            setTab={setTab}
            counts={{
              repositories: repos?.length ?? null,
              followed: followedRepos?.length ?? null,
              starred: starredRepos?.length ?? null,
              "git-follows": gitAuthorFollows?.length ?? null,
            }}
          />
        </div>
      </div>

      {/* Tab content */}
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        {activeTab === "activity" && (
          <ActivityFeed events={activity} pageUserPubkey={pubkey} />
        )}

        {activeTab === "repositories" && (
          <RepositoriesTab
            repos={repos}
            pinnedRepos={pinnedRepos}
            pinnedCoords={pinnedCoords}
            isOwnProfile={isOwnProfile}
            pubkey={pubkey}
          />
        )}

        {activeTab === "followed" && (
          <>
            {!followedRepos ? (
              <div className="grid gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <RepoSkeleton key={i} />
                ))}
              </div>
            ) : followedRepos.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 px-8 text-center">
                  <Eye className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-muted-foreground">
                    No followed repositories found.
                  </p>
                  <p className="text-muted-foreground/60 text-sm mt-1">
                    This user hasn&apos;t followed any repositories yet.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {followedRepos.map((repo) => (
                  <UserRepoCard
                    key={`${repo.selectedMaintainer}:${repo.dTag}`}
                    repo={repo}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "starred" && (
          <>
            {!starredRepos ? (
              <div className="grid gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <RepoSkeleton key={i} />
                ))}
              </div>
            ) : starredRepos.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 px-8 text-center">
                  <Star className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-muted-foreground">
                    No starred repositories found.
                  </p>
                  <p className="text-muted-foreground/60 text-sm mt-1">
                    This user hasn&apos;t starred any repositories yet.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {starredRepos.map((repo) => (
                  <UserRepoCard
                    key={`${repo.selectedMaintainer}:${repo.dTag}`}
                    repo={repo}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "git-follows" && (
          <>
            {!gitAuthorFollows ? (
              <div className="grid gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <GitAuthorSkeleton key={i} />
                ))}
              </div>
            ) : gitAuthorFollows.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 px-8 text-center">
                  <Users className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-muted-foreground">
                    No followed git authors found.
                  </p>
                  <p className="text-muted-foreground/60 text-sm mt-1">
                    This user hasn&apos;t followed any git authors yet.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {gitAuthorFollows.map((followedPubkey) => (
                  <GitAuthorCard key={followedPubkey} pubkey={followedPubkey} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TabsNav
//
// Mobile  (<sm): all 5 tabs, icon-only — fits comfortably in any phone width
// sm+          : labels shown; secondary tabs ("Starred", "Followed Authors")
//                collapse into a "…" dropdown to keep the bar tidy on narrow
//                desktop / tablet widths
// ---------------------------------------------------------------------------

// Tabs always shown with labels on sm+ screens
const PRIMARY_TABS: TabId[] = ["activity", "repositories", "followed"];
// Tabs that collapse into the "…" dropdown on sm+ screens
const SECONDARY_TABS: TabId[] = ["starred", "git-follows"];

interface TabsNavProps {
  activeTab: TabId;
  setTab: (tab: TabId) => void;
  counts: Partial<Record<TabId, number | null>>;
}

function TabsNav({ activeTab, setTab, counts }: TabsNavProps) {
  const secondaryIsActive = SECONDARY_TABS.includes(activeTab);

  return (
    <nav className="flex gap-1 -mb-px" aria-label="Profile tabs">
      {/* Mobile: all tabs, icon-only */}
      <div className="flex sm:hidden gap-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count = counts[tab.id] ?? null;
          return (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={isActive}
              count={count}
              iconOnly
              onClick={() => setTab(tab.id)}
            />
          );
        })}
      </div>

      {/* sm+: primary tabs with labels */}
      <div className="hidden sm:flex gap-1">
        {TABS.filter((t) => PRIMARY_TABS.includes(t.id)).map((tab) => {
          const isActive = activeTab === tab.id;
          const count = counts[tab.id] ?? null;
          return (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={isActive}
              count={count}
              onClick={() => setTab(tab.id)}
            />
          );
        })}
      </div>

      {/* sm+: secondary tabs with labels (md+) or in "…" dropdown (sm–md) */}
      <div className="hidden md:flex gap-1">
        {TABS.filter((t) => SECONDARY_TABS.includes(t.id)).map((tab) => {
          const isActive = activeTab === tab.id;
          const count = counts[tab.id] ?? null;
          return (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={isActive}
              count={count}
              onClick={() => setTab(tab.id)}
            />
          );
        })}
      </div>

      {/* "…" dropdown — sm to md only */}
      <div className="hidden sm:flex md:hidden items-end pb-px">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors",
                secondaryIsActive
                  ? "border-pink-500 text-pink-600 dark:text-pink-400"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">More</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {TABS.filter((t) => SECONDARY_TABS.includes(t.id)).map((tab) => {
              const count = counts[tab.id] ?? null;
              return (
                <DropdownMenuItem
                  key={tab.id}
                  onClick={() => setTab(tab.id)}
                  className="flex items-center gap-2"
                >
                  {tab.icon}
                  {tab.label}
                  {count !== null && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 h-4 min-w-4 ml-auto"
                    >
                      {count}
                    </Badge>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}

interface TabButtonProps {
  tab: { id: TabId; label: string; icon: ReactNode };
  isActive: boolean;
  count: number | null;
  iconOnly?: boolean;
  onClick: () => void;
}

function TabButton({
  tab,
  isActive,
  count,
  iconOnly = false,
  onClick,
}: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      title={iconOnly ? tab.label : undefined}
      className={cn(
        "inline-flex items-center gap-2 border-b-2 transition-colors text-sm font-medium",
        iconOnly ? "px-3 py-3" : "px-4 py-3",
        isActive
          ? "border-pink-500 text-pink-600 dark:text-pink-400"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
      )}
    >
      {tab.icon}
      {!iconOnly && tab.label}
      {!iconOnly && count !== null && (
        <Badge
          variant={isActive ? "default" : "secondary"}
          className={cn(
            "text-[10px] px-1.5 py-0 h-4 min-w-4",
            isActive &&
              "bg-pink-500/20 text-pink-600 dark:text-pink-400 border-0",
          )}
        >
          {count}
        </Badge>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// RepositoriesTab — pinned section at top, other repos below
// ---------------------------------------------------------------------------

interface RepositoriesTabProps {
  repos: ResolvedRepo[] | undefined;
  pinnedRepos: ResolvedRepo[] | undefined;
  pinnedCoords: string[] | undefined;
  isOwnProfile: boolean;
  pubkey: string;
}

function RepositoriesTab({
  repos,
  pinnedRepos,
  pinnedCoords,
  isOwnProfile,
  pubkey,
}: RepositoriesTabProps) {
  const loading = !repos;

  if (loading) {
    return (
      <div className="space-y-8">
        {/* Pinned skeleton */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <RepoSkeleton variant="pinned" />
            <RepoSkeleton variant="pinned" />
          </div>
        </div>
        {/* Other skeleton */}
        <div>
          <Skeleton className="h-4 w-36 mb-4" />
          <div className="grid gap-2">
            <RepoSkeleton />
            <RepoSkeleton />
            <RepoSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 px-8 text-center">
          <GitBranch className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">
            No repository announcements found for this user.
          </p>
          <p className="text-muted-foreground/60 text-sm mt-1">
            They may not have published any repositories yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  const pinnedCoordSet = new Set(pinnedCoords ?? []);
  const otherRepos = repos.filter((r) => {
    const coord = `30617:${r.selectedMaintainer}:${r.dTag}`;
    return !pinnedCoordSet.has(coord);
  });

  // Resolved pinned repos in order (may be undefined while loading)
  const resolvedPinned = pinnedRepos ?? [];

  return (
    <div className="space-y-8">
      <PinnedReposSection
        pinnedRepos={resolvedPinned}
        pinnedCoords={pinnedCoords ?? []}
        isOwnProfile={isOwnProfile}
        pubkey={pubkey}
      />

      {otherRepos.length > 0 && (
        <OtherReposSection
          repos={otherRepos}
          pinnedCoords={pinnedCoords}
          isOwnProfile={isOwnProfile}
          hasPinned={resolvedPinned.length > 0}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PinnedReposSection — drag-to-reorder grid of pinned repos
// ---------------------------------------------------------------------------

interface PinnedReposSectionProps {
  pinnedRepos: ResolvedRepo[];
  pinnedCoords: string[];
  isOwnProfile: boolean;
  pubkey: string;
}

function PinnedReposSection({
  pinnedRepos,
  pinnedCoords,
  isOwnProfile,
}: PinnedReposSectionProps) {
  const { reorderPinnedRepos, pending } = useRobustPinnedRepoActions();
  const { toast } = useToast();

  // Local optimistic order — mirrors pinnedCoords but lets us reorder instantly
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const effectiveOrder = localOrder ?? pinnedCoords;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = effectiveOrder.indexOf(active.id as string);
      const newIndex = effectiveOrder.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(effectiveOrder, oldIndex, newIndex);
      setLocalOrder(newOrder);

      try {
        await reorderPinnedRepos(newOrder);
        setLocalOrder(null); // server confirmed — let reactive state take over
      } catch (err) {
        setLocalOrder(null); // revert
        toast({
          title: "Failed to reorder pinned repositories",
          description:
            err instanceof Error
              ? err.message
              : "An unexpected error occurred.",
          variant: "destructive",
        });
      }
    },
    [effectiveOrder, reorderPinnedRepos, toast],
  );

  // Build display list in effective order
  const orderedPinned = effectiveOrder
    .map((coord) =>
      pinnedRepos.find(
        (r) => `30617:${r.selectedMaintainer}:${r.dTag}` === coord,
      ),
    )
    .filter((r): r is ResolvedRepo => !!r);

  const hasPinned = orderedPinned.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Pin className="h-3.5 w-3.5 text-pink-500" />
        <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wider">
          Pinned
        </h2>
        {isOwnProfile && hasPinned && (
          <span className="text-xs text-muted-foreground/50 ml-1">
            · drag to reorder
          </span>
        )}
        {isOwnProfile && pending && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />
        )}
      </div>

      {hasPinned ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={effectiveOrder}
            strategy={verticalListSortingStrategy}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {orderedPinned.map((repo) => {
                const coord = `30617:${repo.selectedMaintainer}:${repo.dTag}`;
                return (
                  <SortablePinnedRepoCard
                    key={coord}
                    id={coord}
                    repo={repo}
                    isDraggable={isOwnProfile}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      ) : isOwnProfile ? (
        <Card className="border-dashed border-pink-500/20 bg-pink-500/[0.02]">
          <CardContent className="py-8 px-6 text-center">
            <Pin className="h-8 w-8 mx-auto text-pink-500/30 mb-2" />
            <p className="text-sm text-muted-foreground">
              No pinned repositories yet.
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Pin repos from the list below to showcase them here.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OtherReposSection — compact collapsible list of non-pinned repos
// ---------------------------------------------------------------------------

interface OtherReposSectionProps {
  repos: ResolvedRepo[];
  pinnedCoords: string[] | undefined;
  isOwnProfile: boolean;
  hasPinned: boolean;
}

function OtherReposSection({
  repos,
  pinnedCoords,
  isOwnProfile,
  hasPinned,
}: OtherReposSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 mb-4 group"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
        )}
        <h2 className="text-sm font-semibold text-muted-foreground/70 uppercase tracking-wider group-hover:text-foreground/80 transition-colors">
          {hasPinned ? "Other repositories" : "Repositories"}
        </h2>
        <span className="text-xs text-muted-foreground/40">
          ({repos.length})
        </span>
      </button>

      {!collapsed && (
        <div className="grid gap-2">
          {repos.map((repo) => (
            <UserRepoCard
              key={`${repo.selectedMaintainer}:${repo.dTag}`}
              repo={repo}
              pinnedCoords={pinnedCoords}
              showPinControl={isOwnProfile}
              compact
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortablePinnedRepoCard — pinned card with drag handle
// ---------------------------------------------------------------------------

interface SortablePinnedRepoCardProps {
  id: string;
  repo: ResolvedRepo;
  isDraggable: boolean;
}

function SortablePinnedRepoCard({
  id,
  repo,
  isDraggable,
}: SortablePinnedRepoCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <PinnedRepoCard
        repo={repo}
        isDraggable={isDraggable}
        isDragging={isDragging}
        dragHandleProps={isDraggable ? { ...attributes, ...listeners } : {}}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PinnedRepoCard — larger featured card for pinned repos
// ---------------------------------------------------------------------------

interface PinnedRepoCardProps {
  repo: ResolvedRepo;
  isDraggable: boolean;
  isDragging: boolean;
  dragHandleProps: React.HTMLAttributes<HTMLButtonElement>;
}

function PinnedRepoCard({
  repo,
  isDraggable,
  isDragging,
  dragHandleProps,
}: PinnedRepoCardProps) {
  const repoPath = useRepoPath(repo.selectedMaintainer, repo.dTag, repo.relays);
  const navigate = useNavigate();
  const { pinRepo, unpinRepo, pending } = useRobustPinnedRepoActions();
  const { toast } = useToast();
  const timeAgo = formatDistanceToNow(new Date(repo.updatedAt * 1000), {
    addSuffix: true,
  });
  const coord = `30617:${repo.selectedMaintainer}:${repo.dTag}`;

  const handleUnpin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await unpinRepo(coord);
    } catch (err) {
      toast({
        title: "Failed to unpin repository",
        description:
          err instanceof Error ? err.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  // Suppress unused warning — pinRepo is available for future use
  void pinRepo;

  return (
    <div
      className={cn(
        "group block cursor-pointer select-none",
        isDragging && "opacity-50",
      )}
      onClick={() => !isDragging && navigate(repoPath)}
    >
      <Card
        className={cn(
          "transition-all duration-200 h-full",
          isDragging
            ? "shadow-lg shadow-pink-500/10 border-pink-500/30 ring-1 ring-pink-500/20"
            : "hover:shadow-md hover:shadow-pink-500/5 hover:border-pink-500/20 group-hover:-translate-y-0.5",
        )}
      >
        <CardContent className="p-5 flex flex-col h-full gap-3">
          {/* Header row */}
          <div className="flex items-start gap-2">
            {isDraggable && (
              <button
                {...dragHandleProps}
                onClick={(e) => e.stopPropagation()}
                className="mt-0.5 p-0.5 rounded text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors cursor-grab active:cursor-grabbing shrink-0 touch-none"
                title="Drag to reorder"
                aria-label="Drag to reorder"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-pink-500/15 to-pink-500/5 shrink-0">
                  <GitBranch className="h-4 w-4 text-pink-500" />
                </div>
                <h3 className="font-semibold text-base truncate group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
                  {repo.name}
                </h3>
              </div>
            </div>
            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              {isDraggable && (
                <button
                  onClick={handleUnpin}
                  disabled={pending}
                  title="Unpin repository"
                  className="p-1 rounded text-muted-foreground/30 hover:text-pink-500 opacity-0 group-hover:opacity-100 transition-all"
                >
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PinOff className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {repo.webUrls.length > 0 && (
                <a
                  href={repo.webUrls[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 text-muted-foreground/30 hover:text-pink-500 opacity-0 group-hover:opacity-100 transition-all"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>

          {/* Description */}
          {repo.description ? (
            <p className="text-sm text-muted-foreground line-clamp-2 flex-1">
              {repo.description}
            </p>
          ) : (
            <div className="flex-1" />
          )}

          {/* Footer */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {repo.maintainerSet.map((pk) => (
                <UserLink
                  key={pk}
                  pubkey={pk}
                  avatarSize="sm"
                  nameClassName="text-xs text-muted-foreground"
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground/50">{timeAgo}</span>
            {repo.labels.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {repo.labels.slice(0, 3).map((label) => (
                  <Badge
                    key={label}
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-5"
                  >
                    {label}
                  </Badge>
                ))}
                {repo.labels.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{repo.labels.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface UserRepoCardProps {
  repo: ResolvedRepo;
  /** The set of pinned coords for the profile being viewed. */
  pinnedCoords?: string[];
  /** When true, show the pin/unpin control (own profile only). */
  showPinControl?: boolean;
  /** Compact variant for the "other repos" section. */
  compact?: boolean;
}

function UserRepoCard({
  repo,
  pinnedCoords,
  showPinControl = false,
  compact = false,
}: UserRepoCardProps) {
  const repoPath = useRepoPath(repo.selectedMaintainer, repo.dTag, repo.relays);
  const navigate = useNavigate();
  const timeAgo = formatDistanceToNow(new Date(repo.updatedAt * 1000), {
    addSuffix: true,
  });

  const coord = `30617:${repo.selectedMaintainer}:${repo.dTag}`;
  const isPinned = pinnedCoords?.includes(coord) ?? false;

  if (compact) {
    return (
      <div
        className="group block cursor-pointer"
        onClick={() => navigate(repoPath)}
      >
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:border-border/60 hover:bg-muted/30 transition-all duration-150">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <span className="text-sm font-medium truncate group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
              {repo.name}
            </span>
            {repo.description && (
              <span className="text-xs text-muted-foreground/60 truncate hidden sm:block">
                {repo.description}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground/40 hidden md:block">
              {timeAgo}
            </span>
            {repo.labels.slice(0, 2).map((label) => (
              <Badge
                key={label}
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-4 hidden sm:inline-flex"
              >
                {label}
              </Badge>
            ))}
            {showPinControl && <PinButton coord={coord} isPinned={isPinned} />}
            {repo.webUrls.length > 0 && (
              <a
                href={repo.webUrls[0]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/30 hover:text-pink-500 opacity-0 group-hover:opacity-100 transition-all"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group block cursor-pointer"
      onClick={() => navigate(repoPath)}
    >
      <Card className="transition-all duration-200 hover:shadow-md hover:shadow-pink-500/5 hover:border-pink-500/20 group-hover:-translate-y-0.5">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-pink-500/10 to-pink-500/10">
                  <GitBranch className="h-4 w-4 text-pink-500" />
                </div>
                <h3 className="font-semibold text-base truncate group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
                  {repo.name}
                </h3>
                {isPinned && (
                  <Pin
                    className="h-3.5 w-3.5 text-pink-500 shrink-0"
                    aria-label="Pinned"
                  />
                )}
              </div>

              {repo.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3 ml-9">
                  {repo.description}
                </p>
              )}

              <div className="flex items-center gap-3 ml-9 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  {repo.maintainerSet.map((pk) => (
                    <UserLink
                      key={pk}
                      pubkey={pk}
                      avatarSize="sm"
                      nameClassName="text-xs text-muted-foreground"
                    />
                  ))}
                </div>

                <span className="text-xs text-muted-foreground/60">
                  {timeAgo}
                </span>

                {repo.labels.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {repo.labels.slice(0, 4).map((label) => (
                      <Badge
                        key={label}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 h-5"
                      >
                        {label}
                      </Badge>
                    ))}
                    {repo.labels.length > 4 && (
                      <span className="text-[10px] text-muted-foreground">
                        +{repo.labels.length - 4}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 mt-1">
              {showPinControl && (
                <PinButton coord={coord} isPinned={isPinned} />
              )}
              {repo.webUrls.length > 0 && (
                <a
                  href={repo.webUrls[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground/40 group-hover:text-pink-500 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PinButton — pin/unpin a repo from the logged-in user's pinned list
// ---------------------------------------------------------------------------

function PinButton({ coord, isPinned }: { coord: string; isPinned: boolean }) {
  const { pinRepo, unpinRepo, pending } = useRobustPinnedRepoActions();
  const { toast } = useToast();

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (isPinned) {
        await unpinRepo(coord);
      } else {
        await pinRepo(coord);
      }
    } catch (err) {
      toast({
        title: isPinned
          ? "Failed to unpin repository"
          : "Failed to pin repository",
        description:
          err instanceof Error ? err.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      title={isPinned ? "Unpin repository" : "Pin repository"}
      className={cn(
        "p-1 rounded transition-colors",
        isPinned
          ? "text-pink-500 hover:text-pink-600 dark:hover:text-pink-400"
          : "text-muted-foreground/40 hover:text-pink-500 opacity-0 group-hover:opacity-100",
      )}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isPinned ? (
        <PinOff className="h-3.5 w-3.5" />
      ) : (
        <Pin className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function CopyNpub({ npub }: { npub: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(npub);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs font-mono text-muted-foreground gap-1.5"
      onClick={handleCopy}
    >
      {npub.slice(0, 12)}...{npub.slice(-4)}
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
  );
}

/**
 * Follow / Unfollow button for a user profile page.
 *
 * Uses useRobustFollowActions which:
 *  - Checks that enough outbox + lookup relays are reachable before writing
 *  - Fetches the latest kind:3 from those relays first so we never overwrite
 *    changes made on another client
 *  - Shows a clear error toast if connectivity is insufficient
 *
 * When no kind:3 contact list is found in the store (isFollowing === undefined),
 * clicking Follow shows a confirmation dialog warning the user that we couldn't
 * find an existing follow list. This guards against accidentally creating a
 * fresh list that overwrites one stored on relays we haven't connected to.
 *
 * Only rendered when a different user is logged in (hides for own profile and
 * when logged out).
 */
function FollowButton({ pubkey }: { pubkey: string }) {
  const account = useActiveAccount();
  const isFollowing = useIsFollowing(pubkey);
  const { follow, unfollow, pending } = useRobustFollowActions();
  const { toast } = useToast();
  const [showNoListDialog, setShowNoListDialog] = useState(false);

  // Don't show for own profile or when logged out
  if (!account || account.pubkey === pubkey) return null;

  const doFollow = async () => {
    try {
      await follow(pubkey);
    } catch (err) {
      toast({
        title: "Failed to follow",
        description:
          err instanceof Error ? err.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  const handleClick = async () => {
    if (isFollowing) {
      try {
        await unfollow(pubkey);
      } catch (err) {
        toast({
          title: "Failed to unfollow",
          description:
            err instanceof Error
              ? err.message
              : "An unexpected error occurred.",
          variant: "destructive",
        });
      }
      return;
    }

    // No kind:3 found in the store — warn before creating a fresh list
    if (isFollowing === undefined) {
      setShowNoListDialog(true);
      return;
    }

    await doFollow();
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "h-7 text-xs gap-1.5",
          isFollowing
            ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400"
            : "text-muted-foreground hover:text-foreground",
        )}
        onClick={handleClick}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isFollowing ? (
          <UserMinus className="h-3 w-3" />
        ) : (
          <UserPlus className="h-3 w-3" />
        )}
        {isFollowing ? "Unfollow for Social" : "Follow for Social"}
      </Button>

      <AlertDialog open={showNoListDialog} onOpenChange={setShowNoListDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No follow list found</AlertDialogTitle>
            <AlertDialogDescription>
              We couldn&apos;t find an existing follow list (kind:3) for your
              account on any connected relay. Have you followed anyone on Nostr
              before?
              <br />
              <br />
              If you have an existing follow list on other relays, continuing
              will create a new list with only this person, which may overwrite
              your previous follows. If this is a brand-new account, it&apos;s
              safe to continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowNoListDialog(false);
                void doFollow();
              }}
            >
              Follow anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Git Author Follow / Unfollow button for a user profile page.
 *
 * Manages the NIP-51 Git authors follow list (kind:10017). Unlike the social
 * follow (kind:3), we do NOT warn when no existing list is found — kind:10017
 * is new and most users won't have one yet, so silently creating a fresh list
 * is the expected behaviour.
 *
 * Uses useRobustGitAuthorFollowActions which applies the same connectivity and
 * freshness safeguards as the social follow button.
 *
 * Only rendered when a different user is logged in (hides for own profile and
 * when logged out).
 */
function GitAuthorFollowButton({ pubkey }: { pubkey: string }) {
  const account = useActiveAccount();
  const isGitAuthorFollowing = useIsGitAuthorFollowing(pubkey);
  const { addGitAuthor, removeGitAuthor, pending } =
    useRobustGitAuthorFollowActions();
  const { toast } = useToast();

  // Don't show for own profile or when logged out
  if (!account || account.pubkey === pubkey) return null;

  const handleClick = async () => {
    if (isGitAuthorFollowing) {
      try {
        await removeGitAuthor(pubkey);
      } catch (err) {
        toast({
          title: "Failed to remove git author",
          description:
            err instanceof Error
              ? err.message
              : "An unexpected error occurred.",
          variant: "destructive",
        });
      }
    } else {
      try {
        await addGitAuthor(pubkey);
      } catch (err) {
        toast({
          title: "Failed to add git author",
          description:
            err instanceof Error
              ? err.message
              : "An unexpected error occurred.",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <Button
      variant={isGitAuthorFollowing ? "outline" : "default"}
      size="sm"
      className={cn(
        "h-7 text-xs gap-1.5",
        isGitAuthorFollowing &&
          "border-pink-500/40 text-pink-600 dark:text-pink-400 hover:bg-pink-500/10 hover:text-pink-600 dark:hover:text-pink-400",
      )}
      onClick={handleClick}
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isGitAuthorFollowing ? (
        <UserMinus className="h-3 w-3" />
      ) : (
        <UserPlus className="h-3 w-3" />
      )}
      {isGitAuthorFollowing ? "Unfollow for Git" : "Follow for Git"}
    </Button>
  );
}

function RepoSkeleton({ variant }: { variant?: "pinned" } = {}) {
  if (variant === "pinned") {
    return (
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-5 w-36" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-14 rounded-full" />
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Skeleton className="h-3.5 w-3.5 rounded shrink-0" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-24 ml-auto hidden sm:block" />
    </div>
  );
}

function GitAuthorSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="space-y-1.5 flex-1 min-w-0">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GitAuthorCard({ pubkey }: { pubkey: string }) {
  const navigate = useNavigate();
  const npub = nip19.npubEncode(pubkey);

  return (
    <div
      className="group block cursor-pointer"
      onClick={() => navigate(`/${npub}`)}
    >
      <Card className="transition-all duration-200 hover:shadow-md hover:shadow-pink-500/5 hover:border-pink-500/20 group-hover:-translate-y-0.5">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <UserAvatar pubkey={pubkey} size="md" className="shrink-0" />
            <div className="flex-1 min-w-0">
              <UserName
                pubkey={pubkey}
                className="text-sm font-medium group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors truncate block"
              />
              <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                {npub.slice(0, 16)}...
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
