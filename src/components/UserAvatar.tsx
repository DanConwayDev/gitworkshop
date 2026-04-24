import { Link } from "react-router-dom";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProfile } from "@/hooks/useProfile";
import { useLoadProfile } from "@/hooks/useLoadProfile";
import { useUserPath } from "@/hooks/useUserPath";
import { useIsFollowing } from "@/hooks/useIsFollowing";
import { useIsGitAuthorFollowing } from "@/hooks/useIsGitAuthorFollowing";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { cn } from "@/lib/utils";
import { nip19 } from "nostr-tools";
import { UserCheck } from "lucide-react";

interface UserAvatarProps {
  pubkey: string;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** When true, wraps the avatar in a link to the user's profile page */
  linkToProfile?: boolean;
  /**
   * Shows a small "following" badge on the avatar for users the current
   * account follows. Helps distinguish known contacts from potential
   * impersonators. Defaults to true — set to false to suppress the badge.
   */
  showFollowIndicator?: boolean;
  /**
   * Suppresses the ProfileHoverCard wrapper. Use when the parent component
   * already provides its own ProfileHoverCard (e.g. UserLink) to avoid
   * nesting HoverCard inside a HoverCardTrigger.
   */
  noHoverCard?: boolean;
}

const sizeClasses = {
  xs: "h-4 w-4 text-[8px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
  xl: "h-24 w-24 text-2xl",
};

/**
 * Badge size classes, keyed by avatar size.
 * Kept at ~20% of the avatar dimension so the indicator is subtle
 * but still visible at all sizes.
 */
const badgeSizeClasses = {
  xs: "h-1 w-1", // 4px on a 16px avatar  (~25%)
  sm: "h-1.5 w-1.5", // 6px on a 24px avatar  (~25%)
  md: "h-2 w-2", // 8px on a 32px avatar  (~25%)
  lg: "h-3 w-3", // 12px on a 40px avatar (~30%)
  xl: "h-5 w-5", // 20px on a 96px avatar (~21%)
};

/**
 * Position for a single badge (bottom-right corner).
 * When both badges are shown the git badge sits here (front),
 * and the social badge is offset slightly behind/left of it.
 */
const gitBadgePosClasses = {
  xs: "-bottom-px -right-px",
  sm: "-bottom-px -right-px",
  md: "-bottom-0.5 -right-0.5",
  lg: "-bottom-0.5 -right-0.5",
  xl: "-bottom-1 -right-1",
};

/** Social badge position when shown alone (same corner as git). */
const socialBadgeSoloPosClasses = gitBadgePosClasses;

/**
 * Social badge position when shown alongside the git badge.
 * Offset enough to show a visible green crescent behind the violet badge,
 * but never covering more than ~1/3 of the avatar.
 */
const socialBadgeDualPosClasses = {
  xs: "-bottom-px right-[2px]",
  sm: "-bottom-px right-[2px]",
  md: "-bottom-0.5 right-[3px]",
  lg: "-bottom-0.5 right-1",
  xl: "-bottom-1 right-2",
};

/**
 * Renders an Avatar with the follow-indicator badge dots overlaid.
 * Extracted so ProfileHoverCard can reuse the same badge rendering.
 */
export function AvatarWithBadges({
  avatarEl,
  size,
  showSocial,
  showGit,
}: {
  avatarEl: React.ReactNode;
  size: keyof typeof badgeSizeClasses;
  showSocial: boolean;
  showGit: boolean;
}) {
  const showBoth = showSocial && showGit;

  if (!showSocial && !showGit) return <>{avatarEl}</>;

  return (
    <span className="relative inline-flex shrink-0">
      {avatarEl}

      {/* Social badge — green, behind git badge when both shown */}
      {showSocial && (
        <span
          className={cn(
            "absolute flex items-center justify-center rounded-full",
            "bg-emerald-500 ring-1 ring-background",
            badgeSizeClasses[size],
            showBoth
              ? socialBadgeDualPosClasses[size]
              : socialBadgeSoloPosClasses[size],
            showBoth && "z-10",
          )}
          aria-label="Social follow"
        >
          {size !== "xs" && size !== "sm" && (
            <UserCheck
              className="text-white"
              style={{ width: "65%", height: "65%" }}
              strokeWidth={size === "xl" ? 2 : 2.5}
            />
          )}
        </span>
      )}

      {/* Git badge — pink, always in front at bottom-right */}
      {showGit && (
        <span
          className={cn(
            "absolute flex items-center justify-center rounded-full",
            "bg-pink-500 ring-1 ring-background",
            badgeSizeClasses[size],
            gitBadgePosClasses[size],
            "z-20",
          )}
          aria-label="Git author follow"
        >
          {size !== "xs" && size !== "sm" && (
            <UserCheck
              className="text-white"
              style={{ width: "65%", height: "65%" }}
              strokeWidth={size === "xl" ? 2 : 2.5}
            />
          )}
        </span>
      )}
    </span>
  );
}

export function UserAvatar({
  pubkey,
  className,
  size = "md",
  linkToProfile,
  showFollowIndicator = true,
  noHoverCard = false,
}: UserAvatarProps) {
  useLoadProfile(pubkey);
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
      <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-pink-500/20 text-foreground font-medium">
        {initials}
      </AvatarFallback>
    </Avatar>
  );

  const showGit = showFollowIndicator && isGitAuthorFollowing;
  const showSocial = showFollowIndicator && isFollowing;
  const showBoth = showGit && showSocial;

  // Build tooltip label
  const tooltipLabel = showBoth
    ? "You follow for Git and Social"
    : showGit
      ? "You follow for Git"
      : showSocial
        ? "You follow for Social"
        : null;

  const badgedAvatar = (
    <AvatarWithBadges
      avatarEl={avatarEl}
      size={size}
      showSocial={!!showSocial}
      showGit={!!showGit}
    />
  );

  const avatar = tooltipLabel ? (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* TooltipTrigger needs a single DOM element child */}
        <span className="inline-flex shrink-0">{badgedAvatar}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  ) : (
    badgedAvatar
  );

  if (linkToProfile && pubkey) {
    return (
      <ProfileHoverCard pubkey={pubkey} asChild>
        <Link
          to={userPath}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 hover:opacity-80 transition-opacity"
        >
          {avatar}
        </Link>
      </ProfileHoverCard>
    );
  }

  if (noHoverCard) {
    return avatar;
  }

  return <ProfileHoverCard pubkey={pubkey}>{avatar}</ProfileHoverCard>;
}

interface UserNameProps {
  pubkey: string;
  className?: string;
  /** When true, wraps the name in a link to the user's profile page */
  linkToProfile?: boolean;
}

export function UserName({ pubkey, className, linkToProfile }: UserNameProps) {
  useLoadProfile(pubkey);
  const { name: displayName, isPlaceholder } = useUserDisplayName(pubkey);
  const userPath = useUserPath(pubkey);

  const nameEl = (
    <span
      className={cn(
        "font-medium",
        isPlaceholder && "text-muted-foreground font-mono",
      )}
    >
      {displayName}
    </span>
  );

  if (linkToProfile && pubkey) {
    return (
      <ProfileHoverCard pubkey={pubkey} asChild>
        <Link
          to={userPath}
          onClick={(e) => e.stopPropagation()}
          className={cn("hover:underline", className)}
        >
          {nameEl}
        </Link>
      </ProfileHoverCard>
    );
  }

  return (
    <ProfileHoverCard pubkey={pubkey}>
      <span className={className}>{nameEl}</span>
    </ProfileHoverCard>
  );
}

interface UserLinkProps {
  pubkey: string;
  className?: string;
  avatarSize?: "xs" | "sm" | "md" | "lg" | "xl";
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
  const { name: displayName, isPlaceholder } = useUserDisplayName(pubkey);
  const userPath = useUserPath(pubkey);

  const inner = (
    <>
      {/* noHoverCard=true — UserLink provides its own ProfileHoverCard wrapper */}
      <UserAvatar
        pubkey={pubkey}
        size={avatarSize}
        className="shrink-0"
        noHoverCard
      />
      <span
        className={cn(
          "font-medium",
          !noLink && "hover:underline",
          isPlaceholder && "text-muted-foreground font-mono",
          nameClassName,
        )}
      >
        {displayName}
      </span>
    </>
  );

  if (noLink) {
    return (
      <ProfileHoverCard pubkey={pubkey}>
        <span className={cn("flex items-center gap-1.5", className)}>
          {inner}
        </span>
      </ProfileHoverCard>
    );
  }

  return (
    <ProfileHoverCard pubkey={pubkey} asChild>
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
    </ProfileHoverCard>
  );
}
