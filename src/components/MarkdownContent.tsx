/**
 * MarkdownContent — lazy-loadable markdown renderer with GitHub-style
 * component overrides and syntax highlighting.
 *
 * This module is intentionally NOT re-exported from a barrel file so that
 * React.lazy() can split it (and react-markdown + highlight.js languages)
 * into a separate chunk that doesn't affect initial load.
 *
 * Usage:
 *   const MarkdownContent = lazy(() => import("@/components/MarkdownContent"));
 */
import { useState, useEffect } from "react";
import { cn, markdownUrlTransform } from "@/lib/utils";
import { Link } from "react-router-dom";
import { nip19 } from "nostr-tools";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { remarkNostrMentions } from "applesauce-content/markdown";
import type { Components } from "react-markdown";
import { decodePointer } from "applesauce-core/helpers";
import { getOrCreatePool } from "@/lib/git-grasp-pool";
import { getFileMediaType, toDataUri } from "@/lib/fileMediaType";
import { useProfile } from "@/hooks/useProfile";
import { useUserPath } from "@/hooks/useUserPath";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { genUserName } from "@/lib/genUserName";

// Note: getOrCreatePool is safe to call here because the pool is already
// subscribed by useGitPool higher in the tree (RepoCodePage). We are just
// retrieving the existing pool instance — not creating a new subscription.

// Explicit language imports — only what's needed for a git client.
// This replaces rehype-highlight's default "all languages" bundle (~1.5 MB).
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nix from "highlight.js/lib/languages/nix";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const highlightLanguages = {
  bash,
  c,
  cpp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  makefile,
  markdown,
  nix,
  php,
  python,
  ruby,
  rust,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

const remarkPlugins = [remarkGfm, remarkNostrMentions];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rehypePlugins: any[] = [
  [rehypeHighlight, { languages: highlightLanguages, detect: false }],
];

// ---------------------------------------------------------------------------
// Git-aware image component
// ---------------------------------------------------------------------------

/**
 * Resolve a relative image path against the markdown file's directory.
 * e.g. filePath="docs/guide.md", src="./images/foo.png" → "docs/images/foo.png"
 */
function resolveRelativePath(filePath: string, src: string): string {
  // Build a fake absolute URL so URL() handles ".." etc.
  const base = `https://x/${filePath}`;
  try {
    return new URL(src, base).pathname.slice(1); // strip leading "/"
  } catch {
    return src;
  }
}

function isRelativeSrc(src: string): boolean {
  return (
    !src.startsWith("http://") &&
    !src.startsWith("https://") &&
    !src.startsWith("data:") &&
    !src.startsWith("//")
  );
}

interface GitImageProps {
  src?: string;
  alt?: string;
  cloneUrls: string[];
  commitHash: string;
  filePath: string;
}

function GitImage({
  src,
  alt,
  cloneUrls,
  commitHash,
  filePath,
}: GitImageProps) {
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!src || !isRelativeSrc(src)) {
      // Absolute URL — use as-is (no state change needed, rendered below)
      return;
    }

    let cancelled = false;
    const resolvedPath = resolveRelativePath(filePath, src);
    const mediaType = getFileMediaType(resolvedPath);
    const mime =
      mediaType?.kind === "image"
        ? mediaType.mime
        : mediaType?.kind === "svg"
          ? "image/svg+xml"
          : "application/octet-stream";

    async function load() {
      try {
        // Route through the pool — uses the winning URL with fallback, CORS
        // proxy, and the pool's cache. No filterFailedUrls needed.
        const pool = getOrCreatePool({ cloneUrls });
        const abort = new AbortController();
        const result = await pool.getObjectByPath(
          commitHash,
          resolvedPath,
          abort.signal,
        );
        if (cancelled) return;
        if (!result || result.isDir || !result.data) {
          setError(`Failed to load: ${src}`);
          return;
        }
        setDataUri(toDataUri(result.data, mime));
      } catch {
        if (!cancelled) {
          setError(`Failed to load: ${src}`);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [src, cloneUrls.join(","), commitHash, filePath]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!src) return null;

  // Absolute URL — render directly
  if (!isRelativeSrc(src)) {
    return (
      <img
        src={src}
        alt={alt ?? ""}
        className="max-w-full rounded-md my-3"
        loading="lazy"
      />
    );
  }

  if (error) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 font-mono">
        {error}
      </span>
    );
  }

  if (!dataUri) {
    // Loading placeholder — same dimensions as a typical image
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground font-mono animate-pulse">
        Loading {src}…
      </span>
    );
  }

  return (
    <img
      src={dataUri}
      alt={alt ?? ""}
      className="max-w-full rounded-md my-3"
      loading="lazy"
    />
  );
}

// ---------------------------------------------------------------------------
// Inline Nostr profile mention for markdown — avatar + @name
// ---------------------------------------------------------------------------

function NostrProfileMention({ pubkey }: { pubkey: string }) {
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
// Markdown component factories
// ---------------------------------------------------------------------------

/**
 * Build the react-markdown component overrides.
 * When cloneUrls + commitHash are provided, images with relative paths are
 * fetched from the git server and rendered as data URIs.
 */
function buildComponents(
  cloneUrls: string[],
  commitHash: string | null,
  filePath: string,
): Components {
  const hasGitContext = cloneUrls.length > 0 && commitHash !== null;

  return {
    // Nostr-aware links + external link handling.
    // remarkNostrMentions produces link nodes with children:[] (empty), so we
    // must derive display text from the decoded pointer rather than relying on
    // {children}.
    a: ({ href, children, ...props }) => {
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
            const id = decoded.type === "note" ? decoded.data : decoded.data.id;
            const encoded = nip19.noteEncode(id);
            return (
              <Link to={`/${encoded}`} className="text-primary hover:underline">
                {encoded.slice(0, 12)}…
              </Link>
            );
          }

          if (decoded.type === "naddr") {
            const encoded = nip19.naddrEncode(decoded.data);
            return (
              <Link to={`/${encoded}`} className="text-primary hover:underline">
                {encoded.slice(0, 12)}…
              </Link>
            );
          }
        } catch {
          // invalid identifier — fall through
        }
        // Unknown nostr: URI — render identifier truncated
        return (
          <span className="text-primary font-mono text-sm">
            {identifier.slice(0, 12)}…
          </span>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },

    // Git-aware image rendering
    img: ({ src, alt }) => {
      if (hasGitContext && src && isRelativeSrc(src)) {
        return (
          <GitImage
            src={src}
            alt={alt}
            cloneUrls={cloneUrls}
            commitHash={commitHash!}
            filePath={filePath}
          />
        );
      }
      return (
        <img
          src={src}
          alt={alt ?? ""}
          className="max-w-full rounded-md my-3"
          loading="lazy"
        />
      );
    },

    // Inline code
    code: ({ children, className, ...props }) => {
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
        className="max-w-full overflow-x-auto rounded-lg border border-border bg-muted p-4 text-sm leading-relaxed"
        {...props}
      >
        {children}
      </pre>
    ),

    // Blockquote
    blockquote: ({ children, ...props }) => (
      <blockquote
        className="border-l-4 border-border pl-4 text-muted-foreground italic my-4 break-words"
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

    // Headings
    h1: ({ children, ...props }) => (
      <h1
        className="text-2xl font-bold mt-6 mb-3 pb-2 border-b border-border text-foreground break-words"
        {...props}
      >
        {children}
      </h1>
    ),
    h2: ({ children, ...props }) => (
      <h2
        className="text-xl font-semibold mt-5 mb-2 pb-1.5 border-b border-border text-foreground break-words"
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3
        className="text-lg font-semibold mt-4 mb-2 text-foreground break-words"
        {...props}
      >
        {children}
      </h3>
    ),
    h4: ({ children, ...props }) => (
      <h4
        className="text-base font-semibold mt-3 mb-1.5 text-foreground break-words"
        {...props}
      >
        {children}
      </h4>
    ),
    h5: ({ children, ...props }) => (
      <h5
        className="text-sm font-semibold mt-3 mb-1 text-foreground break-words"
        {...props}
      >
        {children}
      </h5>
    ),
    h6: ({ children, ...props }) => (
      <h6
        className="text-sm font-semibold mt-3 mb-1 text-muted-foreground break-words"
        {...props}
      >
        {children}
      </h6>
    ),

    // Paragraphs
    p: ({ children, ...props }) => (
      <p className="my-3 leading-7 text-foreground/90 break-words" {...props}>
        {children}
      </p>
    ),

    // Lists
    ul: ({ children, ...props }) => (
      <ul
        className="my-3 ml-6 list-disc space-y-1 text-foreground/90"
        {...props}
      >
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
      <li className="leading-7 break-words" {...props}>
        {children}
      </li>
    ),

    // Horizontal rule
    hr: (props) => <hr className="my-6 border-border" {...props} />,

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
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface MarkdownContentProps {
  content: string;
  className?: string;
  /**
   * Clone URLs for the git repository — used to resolve relative image paths.
   * When provided together with commitHash, images like `./logo.png` in the
   * markdown are fetched from the git server and rendered inline.
   */
  cloneUrls?: string[];
  /**
   * Commit hash to use when fetching relative images from git.
   */
  commitHash?: string | null;
  /**
   * Path of the markdown file within the repository (e.g. "docs/guide.md").
   * Used to resolve relative image paths correctly.
   */
  filePath?: string;
}

export function MarkdownContent({
  content,
  className,
  cloneUrls = [],
  commitHash = null,
  filePath = "",
}: MarkdownContentProps) {
  const components = buildComponents(cloneUrls, commitHash, filePath);

  return (
    <div
      className={cn(
        "min-w-0 w-full overflow-hidden",
        className ?? "markdown-content",
      )}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={markdownUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Default export required for React.lazy()
export default MarkdownContent;
