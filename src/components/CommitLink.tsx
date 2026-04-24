/**
 * CommitLink — renders a commit hash, upgrading to a link once verified.
 *
 * Renders as plain monospace text initially, then proactively queries the
 * git pool (L1 cache → IDB → network) to verify the hash is a real commit.
 * Upgrades to a clickable React Router <Link> if confirmed. This avoids
 * linking arbitrary hex strings that are not git commits.
 *
 * No link is shown outside a repo page context.
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { peekPool, getOrCreatePool } from "@/lib/git-grasp-pool";
import { useGitCommitLinkContext } from "./CommitLinkContext";

interface CommitLinkProps {
  /** The raw hex commit hash (7–40 chars). */
  hash: string;
}

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

    // getOrCreatePool so the pool is created if it doesn't exist yet —
    // on issue/comment pages the pool may not have been created by the
    // code page, so peekPool would always return undefined.
    const pool = getOrCreatePool({ cloneUrls: ctx.cloneUrls });

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
  return <code className="font-mono text-[0.875em]">{shortHash}</code>;
}
