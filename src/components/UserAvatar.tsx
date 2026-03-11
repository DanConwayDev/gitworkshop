import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useProfile } from "@/hooks/useProfile";
import { cn } from "@/lib/utils";
import { nip19 } from "nostr-tools";

interface UserAvatarProps {
  pubkey: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

export function UserAvatar({ pubkey, className, size = "md" }: UserAvatarProps) {
  const profile = useProfile(pubkey);
  const npub = nip19.npubEncode(pubkey);
  const initials = profile?.name?.slice(0, 2).toUpperCase() ?? npub.slice(5, 7).toUpperCase();

  return (
    <Avatar className={cn(sizeClasses[size], className)}>
      {profile?.picture && (
        <AvatarImage src={profile.picture} alt={profile?.name ?? npub} />
      )}
      <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-foreground font-medium">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

interface UserNameProps {
  pubkey: string;
  className?: string;
}

export function UserName({ pubkey, className }: UserNameProps) {
  const profile = useProfile(pubkey);
  const npub = nip19.npubEncode(pubkey);
  const displayName = profile?.displayName ?? profile?.name ?? npub.slice(0, 12) + "...";

  return <span className={cn("font-medium", className)}>{displayName}</span>;
}
