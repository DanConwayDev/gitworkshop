/**
 * git-grasp-pool — CORS proxy management
 *
 * Encapsulates all CORS proxy logic so that callers pass original clone URLs
 * and the pool transparently routes through the proxy when needed.
 *
 * Strategy:
 *  1. Check if the origin is in the hardcoded blocked list → use proxy
 *  2. Check the runtime cache for a previous decision → use that
 *  3. Otherwise try direct first; on CORS-like error, retry via proxy
 *  4. Cache the per-origin decision for the session
 */

export const DEFAULT_CORS_PROXY_BASE = "https://cors.isomorphic-git.org";

const DEFAULT_KNOWN_CORS_BLOCKED_ORIGINS = new Set([
  "github.com",
  "gitlab.com",
  "codeberg.org",
  "gitea.com",
]);

/**
 * Manages CORS proxy state for a pool instance.
 *
 * Each pool gets its own CorsProxyManager so that different pools can have
 * different proxy configurations (e.g. for testing). The runtime cache is
 * shared across all URLs within a pool.
 */
export class CorsProxyManager {
  private proxyBase: string | null;
  private knownBlocked: Set<string>;
  /** Per-origin runtime cache: true = needs proxy, false = direct works */
  private proxyCache = new Map<string, boolean>();

  constructor(
    proxyBase: string | null = DEFAULT_CORS_PROXY_BASE,
    knownBlockedOrigins?: string[],
  ) {
    this.proxyBase = proxyBase;
    this.knownBlocked = knownBlockedOrigins
      ? new Set(knownBlockedOrigins)
      : DEFAULT_KNOWN_CORS_BLOCKED_ORIGINS;
  }

  /** Whether the CORS proxy is enabled at all */
  get enabled(): boolean {
    return this.proxyBase !== null;
  }

  /**
   * Returns true if the error looks like a genuine CORS policy rejection.
   * Distinct from network-level failures where the server is simply unreachable.
   */
  isCorsLikeError(err: unknown): boolean {
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
   * Returns true if the given URL's origin is known to require the CORS proxy
   * (either hardcoded or learned at runtime).
   */
  originNeedsProxy(url: string): boolean {
    if (!this.proxyBase) return false;
    try {
      const hostname = new URL(url).hostname;
      if (this.knownBlocked.has(hostname)) return true;
      return this.proxyCache.get(hostname) === true;
    } catch {
      return false;
    }
  }

  /**
   * Returns true if this URL is currently being routed through the CORS proxy.
   */
  urlUsesProxy(url: string): boolean {
    return this.originNeedsProxy(url);
  }

  /**
   * Given a git server URL, return the proxy-prefixed version.
   *
   *   "https://example.com/repo.git"
   *   → "https://cors.isomorphic-git.org/example.com/repo.git"
   */
  toProxyUrl(url: string): string {
    if (!this.proxyBase) return url;
    return `${this.proxyBase}/${url.replace(/^https?:\/\//, "")}`;
  }

  /**
   * Resolve the effective URL to use for a git server, applying the proxy
   * if the origin is known to need it.
   */
  resolveUrl(url: string): string {
    return this.originNeedsProxy(url) ? this.toProxyUrl(url) : url;
  }

  /**
   * Record that a direct connection to this URL's origin succeeded.
   */
  markOriginDirect(url: string): void {
    try {
      const hostname = new URL(url).hostname;
      this.proxyCache.set(hostname, false);
    } catch {
      // ignore invalid URLs
    }
  }

  /**
   * Record that this URL's origin requires the CORS proxy.
   */
  markOriginNeedsProxy(url: string): void {
    try {
      const hostname = new URL(url).hostname;
      this.proxyCache.set(hostname, true);
    } catch {
      // ignore invalid URLs
    }
  }
}
