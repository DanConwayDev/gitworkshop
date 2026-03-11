import { useProfile } from "@/hooks/useProfile";
import { useUser } from "@/hooks/useUser";
import { use$ } from "@/hooks/use$";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ProfileCardProps {
  pubkey: string;
}

function ProfileCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <Skeleton className="h-20 w-20 rounded-full" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
          <div className="space-y-2 w-full">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5 mx-auto" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProfileCard({ pubkey }: ProfileCardProps) {
  const profile = useProfile(pubkey);
  const user = useUser(pubkey);
  const contacts = use$(() => user?.contacts$, [pubkey]);

  if (!profile) {
    return <ProfileCardSkeleton />;
  }

  const displayName =
    profile.displayName ?? profile.name ?? pubkey.slice(0, 16) + "…";

  return (
    <Card>
      {profile.banner && (
        <div
          className="h-24 w-full rounded-t-lg bg-cover bg-center"
          style={{ backgroundImage: `url(${profile.banner})` }}
        />
      )}
      <CardContent className="pt-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <Avatar className="h-20 w-20 border-4 border-background -mt-10">
            <AvatarImage src={profile.picture} alt={displayName} />
            <AvatarFallback className="text-xl">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div>
            <h3 className="font-bold text-lg">{displayName}</h3>
            {profile.nip05 && (
              <p className="text-sm text-muted-foreground">{profile.nip05}</p>
            )}
          </div>

          {profile.about && (
            <p className="text-sm text-muted-foreground max-w-sm line-clamp-4">
              {profile.about}
            </p>
          )}

          <div className="flex flex-wrap gap-2 justify-center">
            {contacts !== undefined && (
              <Badge variant="secondary">{contacts.length} following</Badge>
            )}
            {profile.website && (
              <Badge variant="outline" className="text-xs">
                {profile.website.replace(/^https?:\/\//, "")}
              </Badge>
            )}
            {profile.lud16 && (
              <Badge variant="outline" className="text-xs">
                ⚡ {profile.lud16}
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground font-mono break-all">
            {user?.npub ?? pubkey}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
