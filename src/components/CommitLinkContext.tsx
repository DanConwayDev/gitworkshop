/**
 * GitCommitLinkContext — provides clone URLs and repo base path to any
 * descendant that needs to resolve commit hashes into links.
 *
 * Provided by RepoLayout so that CommentContent and MarkdownContent can
 * linkify bare commit-hash strings without prop drilling.
 *
 * CommitLink uses this context to:
 *   1. Call peekPool(cloneUrls) to get the current pool (if any).
 *   2. Check pool.cache.peekCommit(hash) synchronously — no network request.
 *   3. If found, render a React Router <Link> to `${basePath}/commit/${hash}`.
 *   4. If not found, render the hash as plain monospace text.
 *
 * Using cloneUrls (not a pool reference) means CommitLink always gets the
 * current pool state — even if the pool was created after the context value
 * was first computed.
 */

import { createContext, useContext, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { peekPool } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface GitCommitLinkContextValue {
  /** Clone URLs for the current repository. Empty when outside a repo page. */
  cloneUrls: string[];
  /** Base path for the repo (e.g. "/npub1.../relay/repo"). */
  basePath: string;
}

export const GitCommitLinkContext =
  createContext<GitCommitLinkContextValue | null>(null);

export function useGitCommitLinkContext(): GitCommitLinkContextValue | null {
  return useContext(GitCommitLinkContext);
}

// ---------------------------------------------------------------------------
// CommitLink — renders a commit hash as a link if it exists in the pool cache
// ---------------------------------------------------------------------------

interface CommitLinkProps {
  /** The raw hex commit hash (7–40 chars). */
  hash: string;
}

/**
 * Renders a git commit hash as a link to the commit detail page when the hash
 * is present in the local git pool cache. Falls back to styled monospace text
 * when no pool context is available or the hash is not cached.
 *
 * No network requests are made — only the in-memory cache is consulted.
 */
export function CommitLink({ hash }: CommitLinkProps) {
  const ctx = useGitCommitLinkContext();

  // Synchronous check: look up the pool from the registry and peek the cache.
  function checkExists(): boolean {
    if (!ctx || ctx.cloneUrls.length === 0) return false;
    const pool = peekPool(ctx.cloneUrls);
    return !!pool?.cache.peekCommit(hash);
  }

  const [exists, setExists] = useState<boolean>(checkExists);

  useEffect(() => {
    // Re-check after mount — the pool may have been created or populated
    // by a child page after the initial render.
    const found = checkExists();
    if (found !== exists) setExists(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.cloneUrls.join(","), hash]);

  const shortHash = hash.slice(0, 7);

  if (exists && ctx) {
    return (
      <Link
        to={`${ctx.basePath}/commit/${hash}`}
        className="font-mono text-[0.875em] text-pink-600 dark:text-pink-400 hover:underline"
        title={`View commit ${hash}`}
      >
        {shortHash}
      </Link>
    );
  }

  // Not in cache — render as plain monospace (no link, no network request)
  return (
    <code className="font-mono text-[0.875em] text-muted-foreground">
      {shortHash}
    </code>
  );
}
