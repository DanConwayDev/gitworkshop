/**
 * EventTextContent — plain-text Nostr event content renderer.
 *
 * Uses applesauce's useRenderedContent / NAST pipeline to handle nostr:
 * mentions, URLs, hashtags, etc. Use this for kind:1111 comments and any
 * other plain-text event content (NOT for markdown bodies — use
 * MarkdownContent for those).
 *
 * nevent / naddr mentions are rendered as block-level embedded event previews
 * (matching gitworkshop's EmbeddedEvent pattern). npub / nprofile mentions
 * are rendered inline as avatar + name links.
 */
import { Link } from "react-router-dom";
import { useRenderedContent, type ComponentMap } from "applesauce-react/hooks";
import type { NostrEvent } from "nostr-tools";
import { cn } from "@/lib/utils";
import { useUserPath } from "@/hooks/useUserPath";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { UserAvatar } from "@/components/UserAvatar";
import {
  EmbeddedEventByIdPreview,
  EmbeddedEventByAddressPreview,
} from "@/components/EmbeddedEventPreview";
import { isImageURL, isVideoURL } from "applesauce-core/helpers";
import { BlossomImage, BlossomVideo } from "@/components/BlossomMedia";

// ---------------------------------------------------------------------------
// Mention component — renders nprofile / npub as inline avatar + name
// ---------------------------------------------------------------------------

function MentionComponent({ pubkey }: { pubkey: string }) {
  const { name: displayName, isPlaceholder } = useUserDisplayName(pubkey);
  const userPath = useUserPath(pubkey);

  return (
    <Link
      to={userPath}
      className="inline-flex items-center gap-1 align-middle bg-muted border border-border rounded-full px-1.5 py-0.5 text-sm text-foreground hover:bg-accent hover:text-accent-foreground font-medium transition-colors"
    >
      <UserAvatar pubkey={pubkey} size="xs" className="shrink-0" />
      <span className={cn(isPlaceholder && "text-muted-foreground font-mono")}>
        {displayName}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// ComponentMap — defined at module level so it's stable across renders
// ---------------------------------------------------------------------------

const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => {
    if (isImageURL(node.href)) {
      return (
        <BlossomImage src={node.href} className="max-w-full rounded-md my-2" />
      );
    }
    if (isVideoURL(node.href)) {
      return (
        <BlossomVideo src={node.href} className="max-w-full rounded-md my-2" />
      );
    }
    return (
      <a
        href={node.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline break-all"
      >
        {node.value}
      </a>
    );
  },
  gallery: ({ node }) => (
    <div className="grid grid-cols-2 gap-1 my-2">
      {node.links.map((src) => (
        <BlossomImage
          key={src}
          src={src}
          className="w-full rounded-md object-cover aspect-square"
        />
      ))}
    </div>
  ),
  mention: ({ node }) => {
    const { decoded } = node;

    // Profile mentions — inline avatar + name
    if (decoded.type === "npub") {
      return <MentionComponent pubkey={decoded.data} />;
    }
    if (decoded.type === "nprofile") {
      return <MentionComponent pubkey={decoded.data.pubkey} />;
    }

    // Event references — block-level embedded preview
    if (decoded.type === "note" || decoded.type === "nevent") {
      const pointer =
        decoded.type === "nevent" ? decoded.data : { id: decoded.data };
      return <EmbeddedEventByIdPreview pointer={pointer} className="my-1" />;
    }

    // Addressable event references — block-level embedded preview
    if (decoded.type === "naddr") {
      return (
        <EmbeddedEventByAddressPreview
          pointer={decoded.data}
          className="my-1"
        />
      );
    }

    // Fallback for any other NIP-19 type (nsec, etc.) — just a link
    return (
      <Link
        to={`/${node.encoded}`}
        className="text-primary hover:underline break-all"
      >
        {node.encoded.slice(0, 12)}…
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
 *
 * nevent / naddr mentions render as block-level embedded event previews.
 * npub / nprofile mentions render inline as avatar + name links.
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
