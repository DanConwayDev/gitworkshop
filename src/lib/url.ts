/**
 * Shared URL normalization helpers.
 *
 * `normalizeUrl` is the single canonical normalizer for all URLs in this app
 * (relay WebSocket URLs, git clone URLs, git server URLs, etc.).
 *
 * It wraps Applesauce's `normalizeURL`, which:
 *   - Lowercases the scheme and host
 *   - Removes default ports (80 for ws/http, 443 for wss/https)
 *   - Collapses double slashes in the path
 *
 * On top of that we strip trailing slashes, because different sources
 * (repo announcements, NIP-65 mailboxes, user input) are inconsistent about
 * them and `wss://relay.damus.io` and `wss://relay.damus.io/` must be treated
 * as the same URL.
 *
 * Returns the original string unchanged if it cannot be parsed as a URL.
 */

import { normalizeURL } from "applesauce-core/helpers";

export function normalizeUrl(url: string): string {
  try {
    return normalizeURL(url).replace(/\/+$/, "");
  } catch {
    // Not a valid URL — best-effort: lowercase only the scheme and host
    // (path is case-sensitive), strip trailing slash.
    try {
      const u = new URL(url);
      u.protocol = u.protocol.toLowerCase();
      u.hostname = u.hostname.toLowerCase();
      return u.toString().replace(/\/+$/, "");
    } catch {
      return url.replace(/\/+$/, "");
    }
  }
}
