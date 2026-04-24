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
import React, { useState, useEffect, useCallback } from "react";
import { Link2, Check } from "lucide-react";
import { cn, markdownUrlTransform } from "@/lib/utils";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { remarkNostrMentions } from "applesauce-content/markdown";
import type { Components } from "react-markdown";
import { remarkBareMediaUrls } from "@/lib/remarkBareMediaUrls";
import { remarkCommitLinks } from "@/lib/remarkCommitLinks";
import { decodePointer } from "applesauce-core/helpers";
import { CommitLink } from "@/components/CommitLink";
import { getOrCreatePool } from "@/lib/git-grasp-pool";
import { WrappableCodeBlock } from "@/components/WrappableCodeBlock";
import { getFileMediaType, toDataUri } from "@/lib/fileMediaType";
import { useUserPath } from "@/hooks/useUserPath";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { UserAvatar } from "@/components/UserAvatar";
import {
  EmbeddedEventByIdPreview,
  EmbeddedEventByAddressPreview,
} from "@/components/EmbeddedEventPreview";
import { BlossomImage, BlossomVideo } from "@/components/BlossomMedia";

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

const remarkPlugins = [
  remarkGfm,
  remarkBreaks,
  remarkNostrMentions,
  remarkBareMediaUrls,
  remarkCommitLinks,
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rehypePluginsBase: any[] = [
  [rehypeHighlight, { languages: highlightLanguages, detect: false }],
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rehypePluginsWithHtml: any[] = [
  // 1. Parse raw HTML strings embedded in the markdown source.
  rehypeRaw,
  // 2. Sanitize before highlighting — strips scripts/event-handlers etc.
  //    defaultSchema matches GitHub's allowlist (div, details, summary, …).
  [rehypeSanitize, defaultSchema],
  // 3. Syntax-highlight code blocks (runs on already-sanitised tree).
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
  // Build a fake absolute URL so URL() handles ".." and normalises the path.
  // decodeURIComponent turns %20-encoded segments back to literal characters
  // so they match directory/file names in the git tree (e.g. "3rd Logo - Ziton").
  const base = `https://x/${filePath}`;
  try {
    return decodeURIComponent(new URL(src, base).pathname.slice(1));
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
  width?: number | string;
  height?: number | string;
  title?: string;
  cloneUrls: string[];
  commitHash: string;
  filePath: string;
}

function GitImage({
  src,
  alt,
  width,
  height,
  title,
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

  // Absolute URL — render with Blossom fallback
  if (!isRelativeSrc(src)) {
    return (
      <BlossomImage
        src={src}
        alt={alt ?? ""}
        className="max-w-full rounded-md my-3"
        loading="lazy"
        width={width}
        height={height}
        title={title}
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

  // Promote width/height to inline styles — Tailwind preflight sets
  // `height: auto` on img elements which overrides HTML attributes.
  const sizeStyle: React.CSSProperties = {};
  if (width !== undefined)
    sizeStyle.width =
      typeof width === "number"
        ? width
        : /^\d+$/.test(String(width))
          ? `${width}px`
          : width;
  if (height !== undefined)
    sizeStyle.height =
      typeof height === "number"
        ? height
        : /^\d+$/.test(String(height))
          ? `${height}px`
          : height;

  return (
    <img
      src={dataUri}
      alt={alt ?? ""}
      className="max-w-full rounded-md my-3"
      loading="lazy"
      title={title}
      style={Object.keys(sizeStyle).length > 0 ? sizeStyle : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Inline Nostr profile mention for markdown — avatar + @name
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
// Heading slug + anchor helpers
// ---------------------------------------------------------------------------

/**
 * Convert heading text to a GitHub-compatible anchor slug.
 * Rules: lowercase, spaces → hyphens, strip everything except alphanumerics,
 * hyphens, and underscores. Multiple consecutive hyphens are collapsed.
 */
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Extract plain text from react-markdown children (which may be strings,
 * React elements, or arrays thereof).
 */
function childrenToText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  if (React.isValidElement(children)) {
    const el = children as React.ReactElement<{ children?: React.ReactNode }>;
    return childrenToText(el.props.children);
  }
  return "";
}

/** Heading with an id attribute and a hoverable copy-link icon. */
function HeadingWithAnchor({
  level,
  children,
  className,
  ...props
}: {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children?: React.ReactNode;
  className?: string;
  [key: string]: unknown;
}) {
  const text = childrenToText(children);
  const slug = slugifyHeading(text);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const url = `${window.location.href.split("#")[0]}#${slug}`;
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [slug],
  );

  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

  // Icon size scales with heading level
  const iconSize = level <= 2 ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <Tag
      id={slug}
      className={cn(
        "group/heading flex items-center gap-2 scroll-mt-28",
        className,
      )}
      {...props}
    >
      {children}
      <a
        href={`#${slug}`}
        onClick={handleCopy}
        aria-label={`Copy link to section: ${text}`}
        title={copied ? "Link copied!" : "Copy link to section"}
        className="opacity-0 group-hover/heading:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-foreground"
      >
        {copied ? (
          <Check className={cn(iconSize, "text-green-500")} />
        ) : (
          <Link2 className={iconSize} />
        )}
      </a>
    </Tag>
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
    // remarkCommitLinks produces link nodes with href="commit:<hash>".
    a: ({ href, children, ...props }) => {
      if (href?.startsWith("commit:")) {
        const hash = href.slice(7);
        return <CommitLink hash={hash} />;
      }

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

    // Git-aware image rendering + video support
    img: ({ src, alt, width, height, title }) => {
      // Video URLs are represented as image nodes with alt="__video__"
      if (alt === "__video__" && src) {
        return (
          <BlossomVideo src={src} className="max-w-full rounded-md my-3" />
        );
      }

      if (hasGitContext && src && isRelativeSrc(src)) {
        return (
          <GitImage
            src={src}
            alt={alt}
            width={width}
            height={height}
            title={title}
            cloneUrls={cloneUrls}
            commitHash={commitHash!}
            filePath={filePath}
          />
        );
      }
      if (!src) return null;
      return (
        <BlossomImage
          src={src}
          alt={alt ?? ""}
          className="max-w-full rounded-md my-3"
          loading="lazy"
          width={width}
          height={height}
          title={title}
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
    pre: ({ children }) => <WrappableCodeBlock>{children}</WrappableCodeBlock>,

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

    // Headings — each gets an id slug and a hoverable copy-link anchor
    h1: ({ children, ...props }) => (
      <HeadingWithAnchor
        level={1}
        className="text-2xl font-bold mt-6 mb-3 pb-2 border-b border-border text-foreground break-words"
        {...props}
      >
        {children}
      </HeadingWithAnchor>
    ),
    h2: ({ children, ...props }) => (
      <HeadingWithAnchor
        level={2}
        className="text-xl font-semibold mt-5 mb-2 pb-1.5 border-b border-border text-foreground break-words"
        {...props}
      >
        {children}
      </HeadingWithAnchor>
    ),
    h3: ({ children, ...props }) => (
      <HeadingWithAnchor
        level={3}
        className="text-lg font-semibold mt-4 mb-2 text-foreground break-words"
        {...props}
      >
        {children}
      </HeadingWithAnchor>
    ),
    h4: ({ children, ...props }) => (
      <HeadingWithAnchor
        level={4}
        className="text-base font-semibold mt-3 mb-1.5 text-foreground break-words"
        {...props}
      >
        {children}
      </HeadingWithAnchor>
    ),
    h5: ({ children, ...props }) => (
      <HeadingWithAnchor
        level={5}
        className="text-sm font-semibold mt-3 mb-1 text-foreground break-words"
        {...props}
      >
        {children}
      </HeadingWithAnchor>
    ),
    h6: ({ children, ...props }) => (
      <HeadingWithAnchor
        level={6}
        className="text-sm font-semibold mt-3 mb-1 text-muted-foreground break-words"
        {...props}
      >
        {children}
      </HeadingWithAnchor>
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
  /**
   * Allow raw HTML embedded in the markdown source (e.g. <div>, <details>).
   * Only enable for trusted, file-based content such as README files.
   * Must NOT be enabled for user-generated Nostr content (issues, PRs, comments).
   * Defaults to false.
   */
  allowHtml?: boolean;
}

export function MarkdownContent({
  content,
  className,
  cloneUrls = [],
  commitHash = null,
  filePath = "",
  allowHtml = false,
}: MarkdownContentProps) {
  const components = buildComponents(cloneUrls, commitHash, filePath);
  const rehypePlugins = allowHtml ? rehypePluginsWithHtml : rehypePluginsBase;

  // After the markdown renders, scroll to the heading referenced by the URL
  // hash (if any). We use a short rAF delay so the DOM is fully painted.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(raf);
  }, [content]);

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
