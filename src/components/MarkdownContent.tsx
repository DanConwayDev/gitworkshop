import { Link } from "react-router-dom";
import { nip19 } from "nostr-tools";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkNostrMentions } from "applesauce-content/markdown";
import type { Components } from "react-markdown";
import {
  decodeProfilePointer,
  decodeEventPointer,
} from "applesauce-core/helpers";

const markdownPlugins = [remarkGfm, remarkNostrMentions];

const markdownComponents: Components = {
  a: ({ href, children, ...props }) => {
    if (href?.startsWith("nostr:")) {
      const identifier = href.slice(6);
      try {
        const profile = decodeProfilePointer(identifier);
        if (profile) {
          const npub = nip19.npubEncode(profile.pubkey);
          return (
            <Link to={`/${npub}`} className="text-primary hover:underline">
              {children}
            </Link>
          );
        }
        const event = decodeEventPointer(identifier);
        if (event) {
          const note = nip19.noteEncode(event.id);
          return (
            <Link to={`/${note}`} className="text-primary hover:underline">
              {children}
            </Link>
          );
        }
      } catch {
        // invalid identifier — fall through to plain text
      }
      return <span className="text-primary">{children}</span>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div
      className={
        className ?? "prose prose-sm dark:prose-invert max-w-none break-words"
      }
    >
      <ReactMarkdown
        remarkPlugins={markdownPlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
