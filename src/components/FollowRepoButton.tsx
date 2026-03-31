/**
 * FollowRepoButton — follow / unfollow a repository.
 *
 * Manages the NIP-51 Git repositories follow list (kind:10018). When the user
 * follows, ALL announcement coordinates from the recursive maintainer set are
 * added so the follow is discoverable via any maintainer's announcement. When
 * unfollowing, all those coordinates are removed.
 *
 * The follower count is deduplicated across all maintainer announcements so a
 * user who followed multiple announcements for the same repo is counted once.
 *
 * When no account is logged in, clicking opens the auth modal instead of
 * being disabled — matching the StarButton pattern.
 */

import { useCallback } from "react";
import { BookmarkPlus, Users, Loader2 } from "lucide-react";
import { useActiveAccount } from "applesauce-react/hooks";
import { useIsGitRepoFollowing } from "@/hooks/useIsGitRepoFollowing";
import { useRobustGitRepoFollowActions } from "@/hooks/useRobustGitRepoFollowActions";
import { useRepoFollowers } from "@/hooks/useRepoFollowers";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

interface FollowRepoButtonProps {
  /**
   * All announcement coordinates for this repo (one per confirmed maintainer).
   * Format: "30617:<pubkey>:<dtag>"
   */
  allCoords: string[] | undefined;
  className?: string;
}

export function FollowRepoButton({
  allCoords,
  className,
}: FollowRepoButtonProps) {
  const account = useActiveAccount();
  const { openAuthModal } = useAuthModal();
  const isFollowing = useIsGitRepoFollowing(allCoords);
  const { followRepo, unfollowRepo, pending } = useRobustGitRepoFollowActions();
  const { count } = useRepoFollowers(allCoords);
  const { toast } = useToast();

  const handleClick = useCallback(async () => {
    if (pending) return;
    if (!account) {
      openAuthModal();
      return;
    }
    if (!allCoords || allCoords.length === 0) return;

    try {
      if (isFollowing) {
        await unfollowRepo(...allCoords);
      } else {
        await followRepo(...allCoords);
      }
    } catch (err) {
      toast({
        title: isFollowing
          ? "Failed to unfollow repository"
          : "Failed to follow repository",
        description:
          err instanceof Error ? err.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  }, [
    account,
    openAuthModal,
    allCoords,
    pending,
    isFollowing,
    followRepo,
    unfollowRepo,
    toast,
  ]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={(!allCoords || allCoords.length === 0) && !!account}
      title={
        isFollowing ? "Unfollow this repository" : "Follow this repository"
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        isFollowing
          ? "border-violet-400/60 bg-violet-400/10 text-violet-600 dark:text-violet-400 hover:bg-violet-400/20"
          : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        className,
      )}
      aria-pressed={isFollowing ?? false}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isFollowing ? (
        <Users
          className={cn(
            "h-3.5 w-3.5 transition-colors fill-violet-500 text-violet-500",
          )}
        />
      ) : (
        <BookmarkPlus className="h-3.5 w-3.5 transition-colors" />
      )}
      <span>{isFollowing ? "Following" : "Follow"}</span>
      {count > 0 && (
        <span
          className={cn(
            "tabular-nums",
            isFollowing
              ? "text-violet-600 dark:text-violet-400"
              : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
