const GITWORKSHOP_HOSTS = new Set(["gitworkshop.dev", "www.gitworkshop.dev"]);

/**
 * Returns an in-app React Router target for an approved public GitWorkshop URL.
 * Other URL schemes and hosts deliberately return null so their native/browser
 * handlers remain in control.
 */
export function getGitWorkshopPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !GITWORKSHOP_HOSTS.has(parsed.host)) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
