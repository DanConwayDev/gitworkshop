/**
 * UnsupportedEventPage — shown when a nevent/note/naddr URL resolves to an
 * event kind that this app doesn't have a dedicated page for (e.g. kind:1
 * text notes, kind:0 profiles embedded as events, etc.).
 *
 * Shows a preview of the event content so the user isn't left with a blank
 * 404, and offers a link to njump.me so they can view it in a general-purpose
 * Nostr client.
 */

import { formatDistanceToNow } from "date-fns";
import { ExternalLink } from "lucide-react";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { UserLink } from "@/components/UserAvatar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EventTextContent } from "@/components/EventTextContent";

interface UnsupportedEventPageProps {
  event: NostrEvent;
  /** Optional relay hints used to build the nevent identifier */
  relayHints?: string[];
}

/** Human-readable label for well-known kinds. */
function kindLabel(kind: number): string {
  switch (kind) {
    case 0:
      return "Profile metadata";
    case 1:
      return "Text note";
    case 3:
      return "Contact list";
    case 4:
      return "Direct message";
    case 5:
      return "Deletion";
    case 6:
      return "Repost";
    case 7:
      return "Reaction";
    case 9735:
      return "Zap receipt";
    case 10002:
      return "Relay list";
    case 30023:
      return "Long-form article";
    default:
      return `kind:${kind}`;
  }
}

export function UnsupportedEventPage({
  event,
  relayHints,
}: UnsupportedEventPageProps) {
  const neventId = nip19.neventEncode({
    id: event.id,
    kind: event.kind,
    author: event.pubkey,
    relays: relayHints?.length ? relayHints.slice(0, 2) : undefined,
  });

  const njumpUrl = `https://njump.me/${neventId}`;
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });

  // For kind:1 and similar text events, show the content.
  // For structured events (kind:0, kind:3, etc.) the content may be JSON or
  // empty — only show it if it looks like readable text.
  const showContent =
    event.content.trim().length > 0 && !event.content.trim().startsWith("{");

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Unsupported event type
        </h1>
        <p className="text-muted-foreground text-sm">
          This app is focused on Git collaboration. This event isn't something
          it can display natively, but you can view it in a general-purpose
          Nostr client.
        </p>
      </div>

      {/* Event preview card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                {kindLabel(event.kind)}
              </Badge>
              <UserLink
                pubkey={event.pubkey}
                avatarSize="sm"
                nameClassName="text-sm"
              />
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {timeAgo}
            </span>
          </div>
        </CardHeader>

        {showContent && (
          <CardContent className="pt-0">
            <div className="rounded-md bg-muted/40 px-4 py-3 text-sm leading-relaxed">
              <EventTextContent event={event} />
            </div>
          </CardContent>
        )}
      </Card>

      {/* External link */}
      <div className="flex items-center gap-3">
        <Button asChild variant="outline" size="sm">
          <a href={njumpUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            View on njump.me
          </a>
        </Button>
        <span className="text-xs text-muted-foreground">
          njump.me is a general-purpose Nostr event viewer
        </span>
      </div>
    </div>
  );
}
