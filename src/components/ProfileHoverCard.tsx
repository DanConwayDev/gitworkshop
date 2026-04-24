import { Link } from "react-router-dom";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/useProfile";
import { useLoadProfile } from "@/hooks/useLoadProfile";
import { useUserPath } from "@/hooks/useUserPath";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { useIsFollowing } from "@/hooks/useIsFollowing";
import { useRobustFollowActions } from "@/hooks/useRobustFollowActions";
import { useActiveAccount } from "applesauce-react/hooks";
import { nip19 } from "nostr-tools";
import { cn } from "@/lib/utils";
import { UserCheck, UserPlus } from "lucide-react";

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
  const { follow, unfollow, pending } = useRobustFollowActions();

  const npub = nip19.npubEncode(pubkey);
  const initials =
    profile?.name?.slice(0, 2).toUpperCase() ?? npub.slice(5, 7).toUpperCase();

  const nip05 = profile?.nip05;

  return (
    <>
      {/* Mini banner */}
      <div className="h-14 bg-muted relative overflow-hidden rounded-t-2xl">
        {profile?.banner && (
          <img
            src={profile.banner}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}

        {/* Follow / Unfollow button — only when logged in and not own profile */}
        {account && account.pubkey !== pubkey && (
          <div className="absolute top-2 right-2">
            {isFollowing ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs gap-1"
                disabled={pending}
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
                disabled={pending}
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
          </div>
        )}
      </div>

      {/* Profile info */}
      <div className="px-4 pb-4">
        {/* Avatar overlapping the banner */}
        <div className="-mt-7 mb-2">
          <Link to={userPath} onClick={(e) => e.stopPropagation()}>
            <Avatar className="size-14 border-2 border-background ring-1 ring-border">
              {profile?.picture && (
                <AvatarImage src={profile.picture} alt={displayName} />
              )}
              <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-pink-500/20 text-foreground font-medium text-lg">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Link>
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
