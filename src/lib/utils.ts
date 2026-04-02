import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";
import { isValidElement, Children, type ReactNode } from "react";

/**
 * Custom urlTransform for react-markdown@10.
 * The default only allows https/http/mailto/irc/xmpp — nostr: URIs would be
 * stripped before our `a` component ever sees them. This extends the allowlist
 * to include nostr: while keeping all other safety checks intact.
 *
 * data: URIs are allowed only for image/* MIME types so that embedded images
 * (e.g. `![](data:image/png;base64,...)`) render correctly while arbitrary
 * data: URIs (e.g. data:text/html) are blocked to prevent XSS.
 */
const safeMarkdownProtocol = /^(https?|ircs?|mailto|xmpp|nostr)$/i;
const safeDataImageUri = /^data:image\//i;
export function markdownUrlTransform(url: string): string {
  if (safeDataImageUri.test(url)) {
    return url;
  }
  const colon = url.indexOf(":");
  if (colon === -1 || safeMarkdownProtocol.test(url.slice(0, colon))) {
    return url;
  }
  return "";
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Safe wrapper around date-fns formatDistanceToNow.
 * Returns null when the timestamp produces an invalid Date (e.g. 0 or NaN).
 * @param timestampSeconds Unix timestamp in seconds
 */
export function safeFormatDistanceToNow(
  timestampSeconds: number,
  options?: { addSuffix?: boolean },
): string | null {
  const d = new Date(timestampSeconds * 1000);
  if (isNaN(d.getTime()) || timestampSeconds === 0) return null;
  return formatDistanceToNow(d, options);
}

/**
 * Safe wrapper around date-fns format.
 * Returns null when the timestamp produces an invalid Date (e.g. 0 or NaN).
 * @param timestampSeconds Unix timestamp in seconds
 */
/**
 * Recursively extract plain text from a React node tree.
 * Used to measure line lengths from react-markdown's children without
 * needing access to the original source string.
 */
export function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    const { children } = node.props as { children?: ReactNode };
    return children ? extractText(Children.toArray(children)) : "";
  }
  return "";
}

export function safeFormat(
  timestampSeconds: number,
  formatStr: string,
): string | null {
  const d = new Date(timestampSeconds * 1000);
  if (isNaN(d.getTime()) || timestampSeconds === 0) return null;
  return format(d, formatStr);
}
