import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";

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
