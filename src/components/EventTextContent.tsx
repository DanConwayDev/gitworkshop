/**
 * EventTextContent — plain-text Nostr event content renderer.
 *
 * Uses applesauce's useRenderedContent / NAST pipeline to handle nostr:
 * mentions, URLs, hashtags, etc. Use this for kind:1111 comments and any
 * other plain-text event content (NOT for markdown bodies — use
 * MarkdownContent for those).
 */
import { Link } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { useRenderedContent, type ComponentMap } from "applesauce-react/hooks";
import type { NostrEvent } from "nostr-tools";
import { cn } from "@/lib/utils";
import { useProfile } from "@/hooks/useProfile";
import { useUserPath } from "@/hooks/useUserPath";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { genUserName } from "@/lib/genUserName";

// ---------------------------------------------------------------------------
// Mention component — renders nprofile / npub as inline avatar + name
// ---------------------------------------------------------------------------

function MentionComponent({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  const userPath = useUserPath(pubkey);
  const npub = nip19.npubEncode(pubkey);
  const displayName =
    profile?.displayName ?? profile?.name ?? genUserName(pubkey);
  const initials =
    profile?.name?.slice(0, 2).toUpperCase() ?? npub.slice(5, 7).toUpperCase();

  return (
    <Link
      to={userPath}
      className="inline-flex items-center gap-1 align-middle text-primary hover:underline font-medium"
    >
      <Avatar className="h-4 w-4 shrink-0">
        {profile?.picture && (
          <AvatarImage src={profile.picture} alt={displayName} />
        )}
        <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-foreground font-medium text-[8px]">
          {initials}
        </AvatarFallback>
      </Avatar>
      @{displayName}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// ComponentMap — defined at module level so it's stable across renders
// ---------------------------------------------------------------------------

const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => (
    <a
      href={node.href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline break-all"
    >
      {node.value}
    </a>
  ),
  mention: ({ node }) => {
    const { decoded } = node;
    if (decoded.type === "npub") {
      return <MentionComponent pubkey={decoded.data} />;
    }
    if (decoded.type === "nprofile") {
      return <MentionComponent pubkey={decoded.data.pubkey} />;
    }
    // For note / nevent / naddr — link to the local route
    return (
      <Link
        to={`/${node.encoded}`}
        className="text-primary hover:underline break-all"
      >
        @{node.encoded.slice(0, 12)}…
      </Link>
    );
  },
  hashtag: ({ node }) => (
    <span className="text-primary font-medium">#{node.name}</span>
  ),
};

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface EventTextContentProps {
  event: NostrEvent;
  className?: string;
}

/**
 * Renders plain-text Nostr event content with nostr: mention support.
 * Intended for kind:1111 comments and similar plain-text events.
 */
export function EventTextContent({ event, className }: EventTextContentProps) {
  // useRenderedContent accepts a stable ComponentMap; we pass the module-level
  // constant so no useMemo is needed here.
  const content = useRenderedContent(event, components);

  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      {content}
    </div>
  );
}
