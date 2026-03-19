/**
 * Thin React hook that subscribes to the GitRepoDataService.
 *
 * Multiple components mounting this hook with the same clone URLs share a
 * single in-flight fetch. The service handles caching, backoff, and Nostr
 * state event integration.
 */

import { useState, useEffect, useRef } from "react";
import {
  subscribeToGitRepoData,
  notifyNewStateEvent,
  type GitRepoData,
  type GitRepoWarning,
  type UrlInfoRefsResult,
} from "@/services/gitRepoDataService";
import type { RepoStateRef } from "@/lib/nip34";

// Re-export types so existing import sites don't need to change
export type { GitRepoData, GitRepoWarning, UrlInfoRefsResult };

export interface UseGitRepoDataOptions {
  /**
   * The HEAD commit ID declared by the authoritative state event (kind:30618).
   * When provided the service immediately starts fetching this commit's data
   * and will re-fetch with backoff when this value changes.
   */
  knownHeadCommit?: string;
  /**
   * All refs declared by the authoritative state event (kind:30618).
   * Used to detect changes to any ref (not just HEAD) so that non-default
   * branch pushes also trigger a backoff re-fetch of infoRefs.
   */
  stateRefs?: RepoStateRef[];
  /**
   * The created_at timestamp (seconds) of the state event that declared
   * knownHeadCommit. Used in the heuristic to decide which commit to display,
   * and as a recency guard — only recent state events trigger backoff polling.
   */
  stateCreatedAt?: number;
}

/**
 * Subscribe to git repository data for the given clone URLs.
 *
 * Returns a reactive snapshot that updates as data arrives from git servers.
 * Multiple hook instances with the same clone URLs share one fetch.
 */
export function useGitRepoData(
  cloneUrls: string[],
  options: UseGitRepoDataOptions = {},
): GitRepoData {
  const { knownHeadCommit, stateRefs, stateCreatedAt } = options;

  const urlsKey = cloneUrls.join(",");

  const [state, setState] = useState<GitRepoData>(() => ({
    loading: cloneUrls.length > 0,
    pulling: false,
    error: null,
    latestCommit: null,
    readmeContent: null,
    readmeFilename: null,
    defaultBranch: null,
    urlInfoRefs: {},
    warning: null,
    lastCheckedAt: null,
  }));

  // Subscribe to the service — re-subscribe when clone URLs change
  useEffect(() => {
    if (cloneUrls.length === 0) {
      setState({
        loading: false,
        pulling: false,
        error: null,
        latestCommit: null,
        readmeContent: null,
        readmeFilename: null,
        defaultBranch: null,
        urlInfoRefs: {},
        warning: null,
        lastCheckedAt: null,
      });
      return;
    }

    const unsubscribe = subscribeToGitRepoData(cloneUrls, (newState) => {
      setState(newState);
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  // Notify the service when the Nostr state event changes.
  // Build a stable key from all ref commit IDs so the effect fires whenever
  // any ref changes, not just HEAD.
  const refsKey = stateRefs
    ? stateRefs
        .map((r) => `${r.name}:${r.commitId}`)
        .sort()
        .join(",")
    : "";

  const prevRefsKey = useRef<string>("");
  useEffect(() => {
    if (!knownHeadCommit || cloneUrls.length === 0) return;
    if (refsKey === prevRefsKey.current) return;
    prevRefsKey.current = refsKey;

    // Convert RepoStateRef[] to the Record<refName, commitId> the service expects
    const refsMap: Record<string, string> = {};
    for (const r of stateRefs ?? []) {
      refsMap[r.name] = r.commitId;
    }

    notifyNewStateEvent(
      cloneUrls,
      knownHeadCommit,
      refsMap,
      stateCreatedAt ?? 0,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey, stateCreatedAt, urlsKey]);

  return state;
}
