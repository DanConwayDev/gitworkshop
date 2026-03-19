import { Link } from "react-router-dom";
import { nip19 } from "nostr-tools";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { remarkNostrMentions } from "applesauce-content/markdown";
import type { Components } from "react-markdown";
import {
  decodeProfilePointer,
  decodeEventPointer,
} from "applesauce-core/helpers";

const remarkPlugins = [remarkGfm, remarkNostrMentions];
const rehypePlugins = [rehypeHighlight];

const markdownComponents: Components = {
  // Nostr-aware links + external link handling
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
        // invalid identifier — fall through
      }
      return <span className="text-primary">{children}</span>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },

  // Inline code — styled like GitHub
  code: ({ children, className, ...props }) => {
    // Block code (inside <pre>) gets className from rehype-highlight; inline doesn't
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="px-1.5 py-0.5 rounded text-[0.875em] font-mono bg-muted text-foreground border border-border/60"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },

  // Code block wrapper
  pre: ({ children, ...props }) => (
    <pre
      className="overflow-x-auto rounded-lg border border-border bg-muted p-4 text-sm leading-relaxed"
      {...props}
    >
      {children}
    </pre>
  ),

  // Blockquote — GitHub-style left border
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-4 border-border pl-4 text-muted-foreground italic my-4"
      {...props}
    >
      {children}
    </blockquote>
  ),

  // Tables
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="border-b border-border" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className="divide-y divide-border" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className="hover:bg-muted/40 transition-colors" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }) => (
    <th
      className="px-3 py-2 text-left font-semibold text-foreground"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="px-3 py-2 text-foreground/80" {...props}>
      {children}
    </td>
  ),

  // Headings with anchor-friendly styling
  h1: ({ children, ...props }) => (
    <h1
      className="text-2xl font-bold mt-6 mb-3 pb-2 border-b border-border text-foreground"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2
      className="text-xl font-semibold mt-5 mb-2 pb-1.5 border-b border-border text-foreground"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-lg font-semibold mt-4 mb-2 text-foreground" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4
      className="text-base font-semibold mt-3 mb-1.5 text-foreground"
      {...props}
    >
      {children}
    </h4>
  ),
  h5: ({ children, ...props }) => (
    <h5 className="text-sm font-semibold mt-3 mb-1 text-foreground" {...props}>
      {children}
    </h5>
  ),
  h6: ({ children, ...props }) => (
    <h6
      className="text-sm font-semibold mt-3 mb-1 text-muted-foreground"
      {...props}
    >
      {children}
    </h6>
  ),

  // Paragraphs
  p: ({ children, ...props }) => (
    <p className="my-3 leading-7 text-foreground/90" {...props}>
      {children}
    </p>
  ),

  // Lists
  ul: ({ children, ...props }) => (
    <ul className="my-3 ml-6 list-disc space-y-1 text-foreground/90" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      className="my-3 ml-6 list-decimal space-y-1 text-foreground/90"
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="leading-7" {...props}>
      {children}
    </li>
  ),

  // Horizontal rule
  hr: (props) => <hr className="my-6 border-border" {...props} />,

  // Images — responsive
  img: ({ src, alt, ...props }) => (
    <img
      src={src}
      alt={alt ?? ""}
      className="max-w-full rounded-md my-3"
      loading="lazy"
      {...props}
    />
  ),

  // Strong / em
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-foreground" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic" {...props}>
      {children}
    </em>
  ),
};

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={className ?? "markdown-content"}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
