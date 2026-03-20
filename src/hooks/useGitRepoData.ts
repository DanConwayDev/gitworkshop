/**
 * Thin React hook that subscribes to a GitGraspPool for a repository.
 *
 * Multiple components mounting this hook with the same clone URLs share a
 * single pool instance. The pool handles caching, backoff, and Nostr state
 * event integration.
 *
 * The hook exposes a GitRepoData shape for consumers.
 * The richer PoolState is also returned for consumers that need it.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { BehaviorSubject } from "rxjs";
import { getOrCreatePool } from "@/lib/git-grasp-pool";
import type {
  PoolState,
  UrlState,
  StateEventInput,
  StateEvent,
} from "@/lib/git-grasp-pool";
import type { Commit } from "@fiatjaf/git-natural-api";
import type { RepoStateRef } from "@/lib/nip34";

// ---------------------------------------------------------------------------
// Re-exported types (backward compat for existing import sites)
// ---------------------------------------------------------------------------

export type UrlInfoRefsResult =
  | {
      status: "ok";
      headCommit: string;
      headRef: string | undefined;
      info: NonNullable<UrlState["infoRefs"]>;
    }
  | { status: "error"; error: string };

export type GitRepoWarning =
  | { kind: "state-commit-unavailable"; stateCommitId: string }
  | {
      kind: "state-behind-git";
      stateCommitId: string;
      gitCommitId: string;
      gitServerUrl: string;
      stateCreatedAt: number;
      gitCommitterDate: number;
    };

export interface GitRepoData {
  loading: boolean;
  pulling: boolean;
  error: string | null;
  latestCommit: Commit | null;
  readmeContent: string | null;
  readmeFilename: string | null;
  defaultBranch: string | null;
  urlInfoRefs: Record<string, UrlInfoRefsResult>;
  warning: GitRepoWarning | null;
  lastCheckedAt: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a PoolState's urls record into the legacy UrlInfoRefsResult shape so
 * that GitServerStatus and other consumers don't need to change yet.
 */
function urlsToInfoRefs(
  urls: Record<string, UrlState>,
): Record<string, UrlInfoRefsResult> {
  const result: Record<string, UrlInfoRefsResult> = {};
  for (const [url, state] of Object.entries(urls)) {
    if (state.status === "permanent-failure" || state.status === "error") {
      result[url] = {
        status: "error",
        error: state.lastError ?? "Unknown error",
      };
    } else if (state.infoRefs && state.headCommit) {
      result[url] = {
        status: "ok",
        headCommit: state.headCommit,
        headRef: state.headRef ?? undefined,
        info: state.infoRefs,
      };
    }
    // "untested" URLs are omitted — they haven't responded yet
  }
  return result;
}

/**
 * Map a PoolState warning into the legacy GitRepoWarning shape.
 */
function poolWarningToGitWarning(
  warning: PoolState["warning"],
): GitRepoWarning | null {
  if (!warning) return null;
  return warning;
}

/**
 * Derive a GitRepoData snapshot from a PoolState.
 */
function poolStateToGitRepoData(state: PoolState): GitRepoData {
  return {
    loading: state.loading,
    pulling: state.pulling,
    error: state.error,
    latestCommit: state.latestCommit,
    readmeContent: state.readmeContent,
    readmeFilename: state.readmeFilename,
    defaultBranch: state.defaultBranch,
    urlInfoRefs: urlsToInfoRefs(state.urls),
    warning: poolWarningToGitWarning(state.warning),
    lastCheckedAt: state.lastCheckedAt,
  };
}

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

export interface UseGitRepoDataOptions {
  knownHeadCommit?: string;
  stateRefs?: RepoStateRef[];
  stateCreatedAt?: number;
}

// ---------------------------------------------------------------------------
// useGitRepoData
// ---------------------------------------------------------------------------

/**
 * Subscribe to git repository data for the given clone URLs.
 *
 * Returns a reactive GitRepoData snapshot that updates as data arrives.
 * Multiple hook instances with the same clone URLs share one pool.
 */
export function useGitRepoData(
  cloneUrls: string[],
  options: UseGitRepoDataOptions = {},
): GitRepoData {
  const { knownHeadCommit, stateRefs, stateCreatedAt } = options;

  const urlsKey = cloneUrls.join(",");

  // Build a stable key from the state event so we can detect changes
  const refsKey = stateRefs
    ? stateRefs
        .map((r) => `${r.name}:${r.commitId}`)
        .sort()
        .join(",")
    : "";

  // The stateEvent$ BehaviorSubject is created once per clone-URL set and
  // lives for the lifetime of the subscription. We push new values into it
  // whenever the Nostr state event changes.
  const stateSubjectRef = useRef<BehaviorSubject<StateEventInput> | null>(null);

  // Build the current StateEvent value from the hook options
  const currentStateEvent = useMemo<StateEventInput>(() => {
    if (!knownHeadCommit) return undefined;
    const refs = stateRefs ?? [];
    if (refs.length === 0) return undefined;
    return {
      headCommitId: knownHeadCommit,
      refs: refs.map((r) => ({ name: r.name, commitId: r.commitId })),
      createdAt: stateCreatedAt ?? 0,
    } satisfies StateEvent;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownHeadCommit, refsKey, stateCreatedAt]);

  // Keep the subject's current value in sync with the latest state event.
  // This runs on every render where the state event changes, before the
  // subscription effect below (effects run after render).
  const prevRefsKey = useRef<string>("");
  if (refsKey !== prevRefsKey.current) {
    prevRefsKey.current = refsKey;
    if (stateSubjectRef.current) {
      stateSubjectRef.current.next(currentStateEvent);
    }
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

  // Subscribe to the pool — re-subscribe when clone URLs change.
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
      stateSubjectRef.current = null;
      return;
    }

    // Create a fresh BehaviorSubject seeded with the current state event.
    // The pool subscribes to this observable and reacts to future emissions.
    const subject = new BehaviorSubject<StateEventInput>(currentStateEvent);
    stateSubjectRef.current = subject;

    const pool = getOrCreatePool({
      cloneUrls,
      stateEvent$: subject.asObservable(),
    });

    const unsubscribe = pool.subscribe((poolState) => {
      setState(poolStateToGitRepoData(poolState));
    });

    return () => {
      unsubscribe();
      // Don't complete the subject here — the pool may still be alive
      // (shared with other subscribers). Just drop our reference.
      stateSubjectRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  return state;
}
