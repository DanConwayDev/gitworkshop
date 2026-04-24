/**
 * GitCommitLinkContext — provides clone URLs and repo base path to any
 * descendant that needs to resolve commit hashes into links.
 *
 * Provided by RepoLayout so that CommentContent and MarkdownContent can
 * linkify bare commit-hash strings without prop drilling.
 *
 * CommitLink renders as plain monospace text initially, then proactively
 * queries the git pool (cache → IDB → network) to verify the hash exists.
 * If confirmed it upgrades to a React Router <Link>. This avoids linking
 * arbitrary hex strings that happen to be 7–40 chars but are not git commits.
 */

import { createContext, useContext, useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { peekPool } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface GitCommitLinkContextValue {
  /** Clone URLs for the current repository. Used to look up the git pool. */
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
// CommitLink — renders a commit hash, upgrading to a link once verified
// ---------------------------------------------------------------------------

interface CommitLinkProps {
  /** The raw hex commit hash (7–40 chars). */
  hash: string;
}

/**
 * Renders a git commit hash as plain monospace text initially, then
 * proactively queries the git pool (L1 cache → IDB → network) to verify
 * the hash is a real commit. Upgrades to a clickable link if confirmed.
 *
 * This avoids linking arbitrary hex strings that are not git commits.
 * No link is shown outside a repo page context.
 */
export function CommitLink({ hash }: CommitLinkProps) {
  const ctx = useGitCommitLinkContext();
  const shortHash = hash.slice(0, 7);

  // Check L1 cache synchronously so already-known commits link immediately.
  const initialExists = (): boolean => {
    if (!ctx || ctx.cloneUrls.length === 0) return false;
    const pool = peekPool(ctx.cloneUrls);
    return !!pool?.cache.peekCommit(hash);
  };

  const [exists, setExists] = useState<boolean>(initialExists);
  // Stable ref to abort the async lookup on unmount / hash change.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!ctx || ctx.cloneUrls.length === 0) return;

    // Already confirmed — nothing to do.
    if (exists) return;

    const pool = peekPool(ctx.cloneUrls);
    if (!pool) return;

    const abort = new AbortController();
    abortRef.current = abort;

    pool
      .getSingleCommit(hash, abort.signal)
      .then((commit) => {
        if (!abort.signal.aborted && commit) {
          setExists(true);
        }
      })
      .catch(() => {
        // Not a commit or network error — stay as plain text.
      });

    return () => {
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.cloneUrls.join(","), hash]);

  const shortHashEl = (
    <code className="font-mono text-[0.875em]">{shortHash}</code>
  );

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

  // Not yet verified or outside a repo page — plain monospace text.
  return shortHashEl;
}
