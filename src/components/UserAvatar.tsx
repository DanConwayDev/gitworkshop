import { Link } from "react-router-dom";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProfile } from "@/hooks/useProfile";
import { useUserPath } from "@/hooks/useUserPath";
import { useIsFollowing } from "@/hooks/useIsFollowing";
import { useIsGitAuthorFollowing } from "@/hooks/useIsGitAuthorFollowing";
import { cn } from "@/lib/utils";
import { nip19 } from "nostr-tools";
import { UserCheck, GitCommitHorizontal } from "lucide-react";

interface UserAvatarProps {
  pubkey: string;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** When true, wraps the avatar in a link to the user's profile page */
  linkToProfile?: boolean;
  /**
   * Shows a small "following" badge on the avatar for users the current
   * account follows. Helps distinguish known contacts from potential
   * impersonators. Defaults to true — set to false to suppress the badge.
   */
  showFollowIndicator?: boolean;
}

const sizeClasses = {
  xs: "h-4 w-4 text-[8px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

/** Icon sizes for the follow indicator badge, keyed by avatar size */
const indicatorSizeClasses = {
  xs: "h-2 w-2 -bottom-px -right-px",
  sm: "h-3 w-3 -bottom-0.5 -right-0.5",
  md: "h-3.5 w-3.5 -bottom-0.5 -right-0.5",
  lg: "h-4 w-4 -bottom-1 -right-1",
};

export function UserAvatar({
  pubkey,
  className,
  size = "md",
  linkToProfile,
  showFollowIndicator = true,
}: UserAvatarProps) {
  const profile = useProfile(pubkey);
  const userPath = useUserPath(pubkey);
  const isFollowing = useIsFollowing(showFollowIndicator ? pubkey : undefined);
  const isGitAuthorFollowing = useIsGitAuthorFollowing(
    showFollowIndicator ? pubkey : undefined,
  );
  const npub = pubkey ? nip19.npubEncode(pubkey) : undefined;
  const initials =
    profile?.name?.slice(0, 2).toUpperCase() ??
    npub?.slice(5, 7).toUpperCase() ??
    "??";

  const avatarEl = (
    <Avatar className={cn(sizeClasses[size], className)}>
      {profile?.picture && (
        <AvatarImage src={profile.picture} alt={profile?.name ?? npub} />
      )}
      <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-foreground font-medium">
        {initials}
      </AvatarFallback>
    </Avatar>
  );

  // Git author follow takes precedence over social follow for the indicator.
  // - Orange badge with git icon  → in git authors list (kind:10017)
  // - Green badge with check icon → social follow only (kind:3)
  const showGitAuthor = showFollowIndicator && isGitAuthorFollowing;
  const showSocialOnly =
    showFollowIndicator && !isGitAuthorFollowing && isFollowing;

  const avatar = showGitAuthor ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative inline-flex shrink-0">
          {avatarEl}
          <span
            className={cn(
              "absolute flex items-center justify-center rounded-full",
              "bg-orange-500 ring-1 ring-background",
              indicatorSizeClasses[size],
            )}
            aria-label="Git author you follow"
          >
            <GitCommitHorizontal
              className="text-white"
              style={{ width: "65%", height: "65%" }}
              strokeWidth={2.5}
            />
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        Git author you follow
      </TooltipContent>
    </Tooltip>
  ) : showSocialOnly ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative inline-flex shrink-0">
          {avatarEl}
          <span
            className={cn(
              "absolute flex items-center justify-center rounded-full",
              "bg-emerald-500 ring-1 ring-background",
              indicatorSizeClasses[size],
            )}
            aria-label="You follow this user"
          >
            <UserCheck
              className="text-white"
              style={{ width: "65%", height: "65%" }}
              strokeWidth={2.5}
            />
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        You follow this user
      </TooltipContent>
    </Tooltip>
  ) : (
    avatarEl
  );

  if (linkToProfile && pubkey) {
    return (
      <Link
        to={userPath}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 hover:opacity-80 transition-opacity"
      >
        {avatar}
      </Link>
    );
  }

  return avatar;
}

interface UserNameProps {
  pubkey: string;
  className?: string;
  /** When true, wraps the name in a link to the user's profile page */
  linkToProfile?: boolean;
}

export function UserName({ pubkey, className, linkToProfile }: UserNameProps) {
  const profile = useProfile(pubkey);
  const userPath = useUserPath(pubkey);
  const npub = pubkey ? nip19.npubEncode(pubkey) : undefined;
  const displayName =
    profile?.displayName ??
    profile?.name ??
    (npub ? npub.slice(0, 12) + "..." : "unknown");

  if (linkToProfile && pubkey) {
    return (
      <Link
        to={userPath}
        onClick={(e) => e.stopPropagation()}
        className={cn("font-medium hover:underline", className)}
      >
        {displayName}
      </Link>
    );
  }

  return <span className={cn("font-medium", className)}>{displayName}</span>;
}

interface UserLinkProps {
  pubkey: string;
  className?: string;
  avatarSize?: "xs" | "sm" | "md" | "lg";
  nameClassName?: string;
  /** Set to true when UserLink is already inside an <a> element to avoid invalid nested anchors. */
  noLink?: boolean;
}

/**
 * Renders a user's avatar and name as a single clickable link to their profile.
 * Use `noLink` when rendering inside another link/anchor to avoid invalid nested <a> elements.
 *
 * Delegates avatar rendering to UserAvatar so the follow indicator is shown
 * automatically for followed users.
 */
export function UserLink({
  pubkey,
  className,
  avatarSize = "sm",
  nameClassName,
  noLink = false,
}: UserLinkProps) {
  const profile = useProfile(pubkey);
  const userPath = useUserPath(pubkey);
  const npub = pubkey ? nip19.npubEncode(pubkey) : undefined;
  const displayName =
    profile?.displayName ??
    profile?.name ??
    (npub ? npub.slice(0, 12) + "..." : "unknown");

  const inner = (
    <>
      {/* showFollowIndicator=true is the default — indicator shows for followed users */}
      <UserAvatar pubkey={pubkey} size={avatarSize} className="shrink-0" />
      <span
        className={cn(
          "font-medium",
          !noLink && "hover:underline",
          nameClassName,
        )}
      >
        {displayName}
      </span>
    </>
  );

  if (noLink) {
    return (
      <span className={cn("flex items-center gap-1.5", className)}>
        {inner}
      </span>
    );
  }

  return (
    <Link
      to={userPath}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "flex items-center gap-1.5 hover:opacity-80 transition-opacity",
        className,
      )}
    >
      {inner}
    </Link>
  );
}
