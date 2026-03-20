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

  // Build a stable refs map and key from all ref commit IDs so effects fire
  // whenever any ref changes, not just HEAD.
  const refsKey = stateRefs
    ? stateRefs
        .map((r) => `${r.name}:${r.commitId}`)
        .sort()
        .join(",")
    : "";

  const refsMap: Record<string, string> = {};
  for (const r of stateRefs ?? []) {
    refsMap[r.name] = r.commitId;
  }

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

  // Track the refs key from the previous subscribe call so we can detect
  // when the state event changes after the initial subscription.
  const subscribedRefsKey = useRef<string>("");

  // Subscribe to the service — re-subscribe when clone URLs change.
  // Pass the current state event info as initialStateEvent so the service
  // has pendingHead set before startFetch() runs, enabling the fast-path
  // cache check (peekCachedInfoRefs) to detect state-behind-git immediately.
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

    const initialStateEvent =
      knownHeadCommit && Object.keys(refsMap).length > 0
        ? {
            headCommitId: knownHeadCommit,
            refs: refsMap,
            stateCreatedAt: stateCreatedAt ?? 0,
          }
        : undefined;

    subscribedRefsKey.current = refsKey;

    const unsubscribe = subscribeToGitRepoData(
      cloneUrls,
      (newState) => {
        setState(newState);
      },
      initialStateEvent,
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  // Notify the service when the Nostr state event changes *after* the initial
  // subscription. The initial value is already passed via initialStateEvent
  // above, so we skip the first call to avoid a redundant notifyNewStateEvent.
  const prevRefsKey = useRef<string>("");
  useEffect(() => {
    if (!knownHeadCommit || cloneUrls.length === 0) return;
    if (refsKey === prevRefsKey.current) return;
    prevRefsKey.current = refsKey;

    // Skip if this is the same refs key we already passed at subscribe time
    // (i.e. the state event hasn't changed since the subscription was set up).
    if (refsKey === subscribedRefsKey.current) return;

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
