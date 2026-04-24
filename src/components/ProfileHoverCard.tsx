import { Link } from "react-router-dom";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarWithBadges } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/useProfile";
import { useLoadProfile } from "@/hooks/useLoadProfile";
import { useUserPath } from "@/hooks/useUserPath";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { useIsFollowing } from "@/hooks/useIsFollowing";
import { useIsGitAuthorFollowing } from "@/hooks/useIsGitAuthorFollowing";
import { useRobustFollowActions } from "@/hooks/useRobustFollowActions";
import { useRobustGitAuthorFollowActions } from "@/hooks/useRobustGitAuthorFollowActions";
import { useActiveAccount } from "applesauce-react/hooks";
import { nip19 } from "nostr-tools";
import { cn } from "@/lib/utils";
import { GitBranch, UserCheck, UserPlus } from "lucide-react";

interface ProfileHoverCardProps {
  pubkey: string;
  children: React.ReactNode;
  /** Pass true when the child is already a single forwardRef element (e.g. a Link) */
  asChild?: boolean;
}

/**
 * Inner body — only mounted when the card is open so we don't pay the
 * profile-load cost for every avatar on the page.
 */
function ProfileHoverCardBody({ pubkey }: { pubkey: string }) {
  useLoadProfile(pubkey);
  const profile = useProfile(pubkey);
  const { name: displayName, isPlaceholder } = useUserDisplayName(pubkey);
  const userPath = useUserPath(pubkey);
  const account = useActiveAccount();
  const isFollowing = useIsFollowing(pubkey);
  const isGitFollowing = useIsGitAuthorFollowing(pubkey);
  const { follow, unfollow, pending: socialPending } = useRobustFollowActions();
  const {
    addGitAuthor,
    removeGitAuthor,
    pending: gitPending,
  } = useRobustGitAuthorFollowActions();

  const npub = nip19.npubEncode(pubkey);
  const initials =
    profile?.name?.slice(0, 2).toUpperCase() ?? npub.slice(5, 7).toUpperCase();

  const nip05 = profile?.nip05;

  return (
    <>
      {/* Mini banner */}
      <div className="h-14 bg-muted overflow-hidden rounded-t-2xl">
        {profile?.banner && (
          <img
            src={profile.banner}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
      </div>

      {/* Profile info */}
      <div className="px-4 pb-4">
        {/* Avatar + follow buttons row */}
        <div className="flex items-end justify-between -mt-7 mb-2">
          <Link to={userPath} onClick={(e) => e.stopPropagation()}>
            <AvatarWithBadges
              size="lg"
              showSocial={!!isFollowing}
              showGit={!!isGitFollowing}
              avatarEl={
                <Avatar className="size-14 border-2 border-background ring-1 ring-border">
                  {profile?.picture && (
                    <AvatarImage src={profile.picture} alt={displayName} />
                  )}
                  <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-pink-500/20 text-foreground font-medium text-lg">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              }
            />
          </Link>

          {/* Follow buttons — only when logged in and not own profile */}
          {account && account.pubkey !== pubkey && (
            <div className="flex gap-1.5 pb-0.5">
              {/* Social follow */}
              {isFollowing ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs gap-1"
                  disabled={socialPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    unfollow(pubkey);
                  }}
                >
                  <UserCheck className="h-3 w-3" />
                  Following
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={socialPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    follow(pubkey);
                  }}
                >
                  <UserPlus className="h-3 w-3" />
                  Follow
                </Button>
              )}

              {/* Git author follow */}
              {isGitFollowing ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs gap-1"
                  disabled={gitPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    removeGitAuthor(pubkey);
                  }}
                >
                  <GitBranch className="h-3 w-3" />
                  Git Following
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  disabled={gitPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    addGitAuthor(pubkey);
                  }}
                >
                  <GitBranch className="h-3 w-3" />
                  Follow for Git
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Display name */}
        <Link
          to={userPath}
          className="font-semibold text-[14px] hover:underline block truncate leading-tight"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            className={cn(
              isPlaceholder && "text-muted-foreground font-mono text-xs",
            )}
          >
            {displayName}
          </span>
        </Link>

        {/* NIP-05 */}
        {nip05 && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {nip05.startsWith("_@") ? nip05.slice(2) : nip05}
          </p>
        )}

        {/* Bio */}
        {profile?.about && (
          <p className="text-xs text-muted-foreground mt-2 line-clamp-3 whitespace-pre-wrap break-words">
            {profile.about}
          </p>
        )}
      </div>
    </>
  );
}

/**
 * Wraps any element with a hover card that shows a profile preview.
 *
 * Usage:
 * ```tsx
 * <ProfileHoverCard pubkey={pubkey} asChild>
 *   <Link to={userPath}>...</Link>
 * </ProfileHoverCard>
 * ```
 */
export function ProfileHoverCard({
  pubkey,
  children,
  asChild,
}: ProfileHoverCardProps) {
  return (
    <HoverCard openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild={asChild}>{children}</HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-72 p-0 rounded-2xl overflow-hidden border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ProfileHoverCardBody pubkey={pubkey} />
      </HoverCardContent>
    </HoverCard>
  );
}
