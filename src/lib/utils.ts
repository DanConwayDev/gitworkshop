import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";

/**
 * Custom urlTransform for react-markdown@10.
 * The default only allows https/http/mailto/irc/xmpp — nostr: URIs would be
 * stripped before our `a` component ever sees them. This extends the allowlist
 * to include nostr: while keeping all other safety checks intact.
 */
const safeMarkdownProtocol = /^(https?|ircs?|mailto|xmpp|nostr)$/i;
export function markdownUrlTransform(url: string): string {
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
export function safeFormat(
  timestampSeconds: number,
  formatStr: string,
): string | null {
  const d = new Date(timestampSeconds * 1000);
  if (isNaN(d.getTime()) || timestampSeconds === 0) return null;
  return format(d, formatStr);
}
