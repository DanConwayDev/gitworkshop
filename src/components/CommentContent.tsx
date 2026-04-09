/**
 * CommentContent — lightweight markdown renderer for kind:1111 comments.
 *
 * Intentionally NOT lazy-loaded: comments render synchronously so there is no
 * "all comments appear at once" flash.
 *
 * Supports:
 *   - NIP-27 / NIP-19 entity rendering (npub, nprofile, note, nevent, naddr)
 *     via remarkNostrMentions
 *   - Inline markdown: **bold**, _italic_, `code`, ~~strikethrough~~
 *   - Fenced code blocks (no syntax highlighting — keeps the bundle tiny)
 *   - Blockquotes, lists, links
 *
 * Does NOT support: syntax highlighting, git-relative images, heading anchors.
 * Use MarkdownContent for full markdown (issue/PR bodies, README files).
 */
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkNostrMentions } from "applesauce-content/markdown";
import { decodePointer } from "applesauce-core/helpers";
import type { Components } from "react-markdown";
import { useUserPath } from "@/hooks/useUserPath";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { UserAvatar } from "@/components/UserAvatar";
import { cn, markdownUrlTransform } from "@/lib/utils";
import { WrappableCodeBlock } from "@/components/WrappableCodeBlock";
import {
  EmbeddedEventByIdPreview,
  EmbeddedEventByAddressPreview,
} from "@/components/EmbeddedEventPreview";

// ---------------------------------------------------------------------------
// Inline Nostr profile mention — avatar + @name
// ---------------------------------------------------------------------------

function NostrProfileMention({ pubkey }: { pubkey: string }) {
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
// react-markdown component overrides — minimal set for comments
// ---------------------------------------------------------------------------

const components: Components = {
  // NIP-27: remarkNostrMentions produces link nodes with href="nostr:..." and
  // children:[] (empty). Decode the pointer from the href directly.
  a: ({ href, children }) => {
    if (href?.startsWith("nostr:")) {
      const identifier = href.slice(6);
      try {
        const decoded = decodePointer(identifier);

        if (decoded.type === "npub" || decoded.type === "nprofile") {
          const pubkey =
            decoded.type === "npub" ? decoded.data : decoded.data.pubkey;
          return <NostrProfileMention pubkey={pubkey} />;
        }

        if (decoded.type === "note" || decoded.type === "nevent") {
          const pointer =
            decoded.type === "nevent" ? decoded.data : { id: decoded.data };
          return <EmbeddedEventByIdPreview pointer={pointer} />;
        }

        if (decoded.type === "naddr") {
          return <EmbeddedEventByAddressPreview pointer={decoded.data} />;
        }
      } catch {
        // invalid identifier — fall through to truncated display
      }
      return (
        <span className="text-primary font-mono text-sm">
          {identifier.slice(0, 12)}…
        </span>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline break-all"
      >
        {children}
      </a>
    );
  },

  // Inline code
  code: ({ children, className }) => {
    const isBlock = !!className;
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="px-1.5 py-0.5 rounded text-[0.875em] font-mono bg-muted text-foreground border border-border/60">
        {children}
      </code>
    );
  },

  // Code block — no syntax highlighting
  pre: ({ children }) => <WrappableCodeBlock>{children}</WrappableCodeBlock>,

  // Blockquote
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-border pl-3 text-muted-foreground italic my-2 break-words">
      {children}
    </blockquote>
  ),

  // Paragraphs — tighter spacing than full MarkdownContent
  p: ({ children }) => (
    <p className="my-1.5 leading-6 break-words">{children}</p>
  ),

  // Lists
  ul: ({ children }) => (
    <ul className="my-1.5 ml-5 list-disc space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 ml-5 list-decimal space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-6 break-words">{children}</li>,

  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,

  // Suppress headings — comments shouldn't have h1/h2 etc.
  h1: ({ children }) => (
    <p className="font-bold text-base my-1.5 break-words">{children}</p>
  ),
  h2: ({ children }) => (
    <p className="font-semibold text-base my-1.5 break-words">{children}</p>
  ),
  h3: ({ children }) => (
    <p className="font-semibold my-1 break-words">{children}</p>
  ),
  h4: ({ children }) => (
    <p className="font-medium my-1 break-words">{children}</p>
  ),
  h5: ({ children }) => (
    <p className="font-medium my-1 break-words">{children}</p>
  ),
  h6: ({ children }) => (
    <p className="font-medium my-1 break-words">{children}</p>
  ),
};

const remarkPlugins = [remarkGfm, remarkNostrMentions];

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface CommentContentProps {
  content: string;
  className?: string;
}

export function CommentContent({ content, className }: CommentContentProps) {
  return (
    <div className={cn("min-w-0 w-full overflow-hidden", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={components}
        urlTransform={markdownUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
