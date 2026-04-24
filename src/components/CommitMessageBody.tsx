/**
 * CommitMessageBody — renders a git commit message body with linkification.
 *
 * Detects and renders:
 *   - Bare git commit hashes (7–40 hex chars) → CommitLink
 *   - NIP-19 nostr identifiers (npub, nevent, naddr, etc.) → profile/event links
 *   - URLs → external links
 *
 * Uses applesauce's useRenderedContent / NAST pipeline with a custom
 * commitHashLinks transformer injected alongside the standard transformers.
 * Whitespace (newlines, indentation) is preserved via whitespace-pre-wrap.
 */
import { Link } from "react-router-dom";
import { useRenderedContent, type ComponentMap } from "applesauce-react/hooks";
import { nostrMentions, links } from "applesauce-content/text";
import { cn } from "@/lib/utils";
import { commitHashLinks } from "@/lib/nastCommitLinks";
import { CommitLink } from "@/components/CommitLink";
import { useUserPath } from "@/hooks/useUserPath";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { UserAvatar } from "@/components/UserAvatar";
import {
  EmbeddedEventByIdPreview,
  EmbeddedEventByAddressPreview,
} from "@/components/EmbeddedEventPreview";

// ---------------------------------------------------------------------------
// Inline profile mention — same style as EventTextContent / CommentContent
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
// ComponentMap — defined at module level for stability
// ---------------------------------------------------------------------------

const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => {
    // Commit hash links produced by commitHashLinks transformer
    if (node.href.startsWith("commit:")) {
      const hash = node.href.slice(7);
      return <CommitLink hash={hash} />;
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
  mention: ({ node }) => {
    const { decoded } = node;

    if (decoded.type === "npub") {
      return <MentionComponent pubkey={decoded.data} />;
    }
    if (decoded.type === "nprofile") {
      return <MentionComponent pubkey={decoded.data.pubkey} />;
    }
    if (decoded.type === "note" || decoded.type === "nevent") {
      const pointer =
        decoded.type === "nevent" ? decoded.data : { id: decoded.data };
      return <EmbeddedEventByIdPreview pointer={pointer} className="my-1" />;
    }
    if (decoded.type === "naddr") {
      return (
        <EmbeddedEventByAddressPreview
          pointer={decoded.data}
          className="my-1"
        />
      );
    }
    return (
      <Link
        to={`/${node.encoded}`}
        className="text-primary hover:underline break-all"
      >
        {node.encoded.slice(0, 12)}…
      </Link>
    );
  },
};

// ---------------------------------------------------------------------------
// Transformer pipeline — standard transformers + commit hash detection.
// We use only links + nostrMentions from the defaults (no galleries, emojis,
// hashtags, lightning, cashu — those aren't relevant in commit messages).
// ---------------------------------------------------------------------------

const commitMessageTransformers = [links, nostrMentions, commitHashLinks];

// Unique cache key so we don't collide with kind:1 note caching
const CommitMessageCacheKey = Symbol("commit-message-body");

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface CommitMessageBodyProps {
  /** The commit message body text (everything after the subject line). */
  body: string;
  className?: string;
}

/**
 * Renders a git commit message body with linkified commit hashes and nostr
 * identifiers. Preserves whitespace/newlines via whitespace-pre-wrap.
 */
export function CommitMessageBody({ body, className }: CommitMessageBodyProps) {
  // useRenderedContent needs an event-like object or a string. Passing the
  // body string directly is supported (it's used as the content).
  const content = useRenderedContent(body, components, {
    cacheKey: CommitMessageCacheKey,
    transformers: commitMessageTransformers,
  });

  return (
    <div
      className={cn(
        "whitespace-pre-wrap break-words text-sm text-muted-foreground font-sans leading-relaxed",
        className,
      )}
    >
      {content}
    </div>
  );
}
