/**
 * CORS proxy support for git HTTP servers.
 *
 * Many self-hosted git servers (Gitea, Forgejo, cgit, etc.) do not set
 * CORS headers, so browser fetch() calls fail with a CORS error.  The
 * isomorphic-git CORS proxy at cors.isomorphic-git.org forwards requests
 * and adds the necessary headers.
 *
 * Strategy (mirrors gitworkshop):
 *  1. Try the bare URL first.
 *  2. If the error looks like a CORS failure, retry via the proxy.
 *  3. Cache the per-origin decision so subsequent calls skip the probe.
 *
 * Because git-natural-api accepts a plain URL (not a corsProxy option),
 * we transform the URL itself: the proxy URL becomes the base and the
 * original URL (minus protocol) is appended as a path.
 *
 *   https://github.com/user/repo.git
 *   → https://cors.isomorphic-git.org/github.com/user/repo.git
 */

export const CORS_PROXY_BASE = "https://cors.isomorphic-git.org";

/**
 * Domains that are hardcoded to always use the CORS proxy.
 * These are well-known public forges that block cross-origin requests.
 */
const KNOWN_CORS_BLOCKED_ORIGINS = new Set([
  "github.com",
  "gitlab.com",
  "codeberg.org",
  "gitea.com",
]);

/** Per-origin runtime cache: true = needs proxy, false = direct works */
const proxyCache = new Map<string, boolean>();

/**
 * Returns true if the error message looks like a CORS / network failure
 * that might be resolved by routing through the proxy.
 */
export function isCorsLikeError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  return /failed to fetch|cors|network/i.test(msg);
}

/**
 * Given a git server URL, return the proxy-prefixed version.
 *
 *   "https://example.com/repo.git"
 *   → "https://cors.isomorphic-git.org/example.com/repo.git"
 */
export function toProxyUrl(url: string): string {
  return `${CORS_PROXY_BASE}/${url.replace(/^https?:\/\//, "")}`;
}

/**
 * Returns true if the given URL's origin is known to require the CORS proxy
 * (either hardcoded or learned at runtime from a previous failed direct fetch).
 */
export function originNeedsProxy(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    if (KNOWN_CORS_BLOCKED_ORIGINS.has(hostname)) return true;
    return proxyCache.get(hostname) === true;
  } catch {
    return false;
  }
}

/**
 * Returns true if this URL is currently being routed through the CORS proxy.
 * Equivalent to originNeedsProxy — exposed as a separate name for clarity at
 * call sites that want to display proxy status in the UI.
 */
export function urlUsesProxy(url: string): boolean {
  return originNeedsProxy(url);
}

/**
 * Record that a direct connection to this URL's origin succeeded.
 * Clears any previously cached proxy requirement.
 */
export function markOriginDirect(url: string): void {
  try {
    const hostname = new URL(url).hostname;
    proxyCache.set(hostname, false);
  } catch {
    // ignore invalid URLs
  }
}

/**
 * Record that this URL's origin requires the CORS proxy.
 */
export function markOriginNeedsProxy(url: string): void {
  try {
    const hostname = new URL(url).hostname;
    proxyCache.set(hostname, true);
  } catch {
    // ignore invalid URLs
  }
}

/**
 * Resolve the effective URL to use for a git server, applying the proxy
 * if the origin is known to need it.
 */
export function resolveGitUrl(url: string): string {
  return originNeedsProxy(url) ? toProxyUrl(url) : url;
}
