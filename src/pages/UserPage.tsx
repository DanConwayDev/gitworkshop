import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { nip19 } from "nostr-tools";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useProfile } from "@/hooks/useProfile";
import { useUserRepositories } from "@/hooks/useUserRepositories";
import { useUserProfileSubscription } from "@/hooks/useUserProfileSubscription";
import { useUserFollowedRepos } from "@/hooks/useUserFollowedRepos";
import { useUserGitAuthorFollows } from "@/hooks/useUserGitAuthorFollows";
import { useUserStarredRepos } from "@/hooks/useUserStarredRepos";
import { usePrefetchNip05 } from "@/hooks/usePrefetchNip05";
import { useRepoPath } from "@/hooks/useRepoPath";
import { useIsFollowing } from "@/hooks/useIsFollowing";
import { useIsGitAuthorFollowing } from "@/hooks/useIsGitAuthorFollowing";
import { useRobustFollowActions } from "@/hooks/useRobustFollowActions";
import { useRobustGitAuthorFollowActions } from "@/hooks/useRobustGitAuthorFollowActions";
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
} from "lucide-react";
import { useState, type ReactNode } from "react";
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

interface UserPageProps {
  pubkey: string;
}

type TabId = "repositories" | "followed" | "starred" | "git-follows";

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
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
  const profile = useProfile(pubkey);
  const repos = useUserRepositories(pubkey);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabId | null) ?? "repositories";

  const setTab = (tab: TabId) => {
    setSearchParams(tab === "repositories" ? {} : { tab });
  };

  // Subscribe to this user's replaceable events (kind 0, 3, 10002, 10017,
  // 10018) for the duration of the profile page visit. No-op for own profile.
  useUserProfileSubscription(pubkey);

  // Reactive data for the three non-repository tabs
  const followedRepos = useUserFollowedRepos(pubkey);
  const gitAuthorFollows = useUserGitAuthorFollows(pubkey);
  const starredRepos = useUserStarredRepos(pubkey);

  // Prefetch NIP-05 identity so useRepoPath resolves it from IDB on next visit
  usePrefetchNip05([pubkey]);
  const npub = nip19.npubEncode(pubkey);

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
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-500/5 via-transparent to-fuchsia-500/5" />
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
                  size="lg"
                  className="h-20 w-20 md:h-24 md:w-24 text-2xl ring-4 ring-background shadow-xl"
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
                      <span className="text-sm text-violet-600 dark:text-violet-400 font-medium">
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
          <nav className="flex gap-1 -mb-px" aria-label="Profile tabs">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const count =
                tab.id === "repositories"
                  ? (repos?.length ?? null)
                  : tab.id === "followed"
                    ? (followedRepos?.length ?? null)
                    : tab.id === "starred"
                      ? (starredRepos?.length ?? null)
                      : tab.id === "git-follows"
                        ? (gitAuthorFollows?.length ?? null)
                        : null;
              return (
                <button
                  key={tab.id}
                  onClick={() => setTab(tab.id)}
                  className={cn(
                    "inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                    isActive
                      ? "border-violet-500 text-violet-600 dark:text-violet-400"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                  )}
                >
                  {tab.icon}
                  {tab.label}
                  {count !== null && (
                    <Badge
                      variant={isActive ? "default" : "secondary"}
                      className={cn(
                        "text-[10px] px-1.5 py-0 h-4 min-w-4",
                        isActive &&
                          "bg-violet-500/20 text-violet-600 dark:text-violet-400 border-0",
                      )}
                    >
                      {count}
                    </Badge>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab content */}
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        {activeTab === "repositories" && (
          <>
            {!repos ? (
              <div className="grid gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <RepoSkeleton key={i} />
                ))}
              </div>
            ) : repos.length === 0 ? (
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
            ) : (
              <div className="grid gap-3">
                {repos.map((repo) => (
                  <UserRepoCard
                    key={`${repo.selectedMaintainer}:${repo.dTag}`}
                    repo={repo}
                  />
                ))}
              </div>
            )}
          </>
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

function UserRepoCard({ repo }: { repo: ResolvedRepo }) {
  const repoPath = useRepoPath(repo.selectedMaintainer, repo.dTag, repo.relays);
  const navigate = useNavigate();
  const timeAgo = formatDistanceToNow(new Date(repo.updatedAt * 1000), {
    addSuffix: true,
  });

  return (
    <div
      className="group block cursor-pointer"
      onClick={() => navigate(repoPath)}
    >
      <Card className="transition-all duration-200 hover:shadow-md hover:shadow-violet-500/5 hover:border-violet-500/20 group-hover:-translate-y-0.5">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10">
                  <GitBranch className="h-4 w-4 text-violet-500" />
                </div>
                <h3 className="font-semibold text-base truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                  {repo.name}
                </h3>
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

            {repo.webUrls.length > 0 && (
              <a
                href={repo.webUrls[0]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/40 group-hover:text-violet-500 transition-colors shrink-0 mt-1"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
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
          "border-violet-500/40 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-400",
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

function RepoSkeleton() {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="ml-9 space-y-2">
          <Skeleton className="h-4 w-full max-w-md" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        </div>
      </CardContent>
    </Card>
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
      <Card className="transition-all duration-200 hover:shadow-md hover:shadow-violet-500/5 hover:border-violet-500/20 group-hover:-translate-y-0.5">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <UserAvatar pubkey={pubkey} size="md" className="shrink-0" />
            <div className="flex-1 min-w-0">
              <UserName
                pubkey={pubkey}
                className="text-sm font-medium group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors truncate block"
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
