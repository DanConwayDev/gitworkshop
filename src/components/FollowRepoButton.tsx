/**
 * FollowRepoButton — follow / unfollow a repository, with a followers popover.
 *
 * Manages the NIP-51 Git repositories follow list (kind:10018). When the user
 * follows, ALL announcement coordinates from the recursive maintainer set are
 * added so the follow is discoverable via any maintainer's announcement. When
 * unfollowing, all those coordinates are removed.
 *
 * The follower count is deduplicated across all maintainer announcements so a
 * user who followed multiple announcements for the same repo is counted once.
 *
 * Clicking the count opens a popover listing all followers.
 *
 * When no account is logged in, clicking opens the auth modal instead of
 * being disabled — matching the StarButton pattern.
 */

import { useCallback, useState } from "react";
import { BookmarkPlus, Users, Loader2 } from "lucide-react";
import { useActiveAccount } from "applesauce-react/hooks";
import { useIsGitRepoFollowing } from "@/hooks/useIsGitRepoFollowing";
import { useRobustGitRepoFollowActions } from "@/hooks/useRobustGitRepoFollowActions";
import { useRepoFollowers } from "@/hooks/useRepoFollowers";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserLink } from "@/components/UserAvatar";

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
  const { count, followers } = useRepoFollowers(allCoords);
  const { toast } = useToast();
  const [popoverOpen, setPopoverOpen] = useState(false);

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

  const followBtnClass = cn(
    "inline-flex items-center gap-1.5 rounded-l-md border px-2.5 py-1 text-sm font-medium transition-colors",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    isFollowing
      ? "border-pink-400/60 bg-pink-400/10 text-pink-600 dark:text-pink-400 hover:bg-pink-400/20"
      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    // When there's no count, round both sides
    count === 0 && "rounded-r-md",
    className,
  );

  const countBtnClass = cn(
    "inline-flex items-center rounded-r-md border-y border-r px-2 py-1 text-sm font-medium tabular-nums transition-colors",
    isFollowing
      ? "border-pink-400/60 bg-pink-400/10 text-pink-600 dark:text-pink-400 hover:bg-pink-400/20"
      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  );

  return (
    <div className={cn("inline-flex", className)}>
      {/* Follow / unfollow action */}
      <button
        type="button"
        onClick={handleClick}
        disabled={(!allCoords || allCoords.length === 0) && !!account}
        title={
          isFollowing ? "Unfollow this repository" : "Follow this repository"
        }
        className={followBtnClass}
        aria-pressed={isFollowing ?? false}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isFollowing ? (
          <Users className="h-3.5 w-3.5 transition-colors fill-pink-500 text-pink-500" />
        ) : (
          <BookmarkPlus className="h-3.5 w-3.5 transition-colors" />
        )}
        <span>{isFollowing ? "Following" : "Follow"}</span>
      </button>

      {/* Count — opens followers popover */}
      {count > 0 && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={countBtnClass}>
              {count}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-56 p-0"
            aria-label="Followers"
          >
            <div className="px-3 py-2 border-b border-border">
              <p className="text-xs font-medium text-muted-foreground">
                {count} {count === 1 ? "follower" : "followers"}
              </p>
            </div>
            <ScrollArea className="max-h-64">
              <div className="py-1">
                {followers.map((pubkey) => (
                  <div key={pubkey} className="px-3 py-1.5">
                    <UserLink
                      pubkey={pubkey}
                      avatarSize="sm"
                      nameClassName="text-sm"
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
