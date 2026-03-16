import { Link } from "react-router-dom";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useProfile } from "@/hooks/useProfile";
import { cn } from "@/lib/utils";
import { nip19 } from "nostr-tools";

interface UserAvatarProps {
  pubkey: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  /** When true, wraps the avatar in a link to the user's profile page */
  linkToProfile?: boolean;
}

const sizeClasses = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

export function UserAvatar({
  pubkey,
  className,
  size = "md",
  linkToProfile,
}: UserAvatarProps) {
  const profile = useProfile(pubkey);
  const npub = pubkey ? nip19.npubEncode(pubkey) : undefined;
  const initials =
    profile?.name?.slice(0, 2).toUpperCase() ??
    npub?.slice(5, 7).toUpperCase() ??
    "??";

  const avatar = (
    <Avatar className={cn(sizeClasses[size], className)}>
      {profile?.picture && (
        <AvatarImage src={profile.picture} alt={profile?.name ?? npub} />
      )}
      <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-foreground font-medium">
        {initials}
      </AvatarFallback>
    </Avatar>
  );

  if (linkToProfile && npub) {
    return (
      <Link
        to={`/${npub}`}
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
  const npub = pubkey ? nip19.npubEncode(pubkey) : undefined;
  const displayName =
    profile?.displayName ??
    profile?.name ??
    (npub ? npub.slice(0, 12) + "..." : "unknown");

  if (linkToProfile && npub) {
    return (
      <Link
        to={`/${npub}`}
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
  avatarSize?: "sm" | "md" | "lg";
  nameClassName?: string;
  /** Set to true when UserLink is already inside an <a> element to avoid invalid nested anchors. */
  noLink?: boolean;
}

/**
 * Renders a user's avatar and name as a single clickable link to their profile.
 * Use `noLink` when rendering inside another link/anchor to avoid invalid nested <a> elements.
 */
export function UserLink({
  pubkey,
  className,
  avatarSize = "sm",
  nameClassName,
  noLink = false,
}: UserLinkProps) {
  const profile = useProfile(pubkey);
  const npub = pubkey ? nip19.npubEncode(pubkey) : undefined;
  const displayName =
    profile?.displayName ??
    profile?.name ??
    (npub ? npub.slice(0, 12) + "..." : "unknown");
  const initials =
    profile?.name?.slice(0, 2).toUpperCase() ??
    npub?.slice(5, 7).toUpperCase() ??
    "??";

  const inner = (
    <>
      <Avatar className={cn(sizeClasses[avatarSize], "shrink-0")}>
        {profile?.picture && (
          <AvatarImage src={profile.picture} alt={profile?.name ?? npub} />
        )}
        <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-foreground font-medium">
          {initials}
        </AvatarFallback>
      </Avatar>
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
      to={`/${npub ?? ""}`}
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
