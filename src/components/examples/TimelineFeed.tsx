import { useTimeline } from "@/hooks/useTimeline";
import { use$ } from "@/hooks/use$";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import type { Note } from "applesauce-common/casts";

const RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];

function NoteCard({ note }: { note: Note }) {
  const profile = use$(() => note.author.profile$, [note.id]);
  const pubkey = note.event.pubkey;

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex gap-3">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage src={profile?.picture} alt={profile?.name} />
            <AvatarFallback>
              {(profile?.name ?? pubkey).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-semibold text-sm truncate">
                {profile?.displayName ??
                  profile?.name ??
                  pubkey.slice(0, 12) + "…"}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatDistanceToNow(note.createdAt, { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap break-words line-clamp-6">
              {note.event.content}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NoteCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex gap-3">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TimelineFeed() {
  const notes = useTimeline(RELAYS, [{ kinds: [1], limit: 20 }]);

  if (!notes) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <NoteCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 px-8 text-center">
          <p className="text-muted-foreground">
            No notes found. Check your relay connections.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}
