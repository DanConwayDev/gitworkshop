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
 * Returns true if the error looks like a genuine CORS policy rejection —
 * i.e. the browser blocked the response because the server didn't send the
 * right Access-Control headers.  This is distinct from a network-level
 * failure (ERR_FAILED, ERR_ADDRESS_UNREACHABLE) where the server is simply
 * unreachable; routing those through a proxy won't help.
 *
 * Heuristic: isomorphic-git / the Fetch API surfaces CORS errors as a
 * TypeError with a message containing "cors" or "cross-origin", or as a
 * generic "Failed to fetch" that is NOT accompanied by a status code.
 * Network-unreachable errors from the browser also say "Failed to fetch"
 * but they tend to arrive as a plain TypeError with no additional context.
 *
 * We treat "Failed to fetch" alone as a CORS candidate only when there is
 * no indication the host is simply down (e.g. no ERR_ADDRESS_UNREACHABLE /
 * ERR_FAILED in the message).  In practice the browser doesn't expose those
 * internal error codes in the JS error message, so we can't distinguish them
 * purely from the message text.  Instead we rely on the fact that a CORS
 * error always has a response (the browser received something and blocked it),
 * whereas a network error has no response at all.
 *
 * Since we can't inspect the response here, we keep the heuristic but
 * explicitly exclude messages that contain "address unreachable" or similar
 * unambiguous network-down signals.
 */
export function isCorsLikeError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  const lower = msg.toLowerCase();
  // Explicit network-down signals — proxy won't help
  if (/address.?unreachable|connection.?refused|err_failed/i.test(lower))
    return false;
  return /failed to fetch|cors|cross.?origin/i.test(lower);
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
