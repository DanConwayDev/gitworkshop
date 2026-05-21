/**
 * useRefsWithStatus — decorate the raw ref list from `useGitExplorer` with
 * per-ref status against the Nostr-signed state and the pool's per-URL
 * `refStatus` view, resolving the user's selected source ("default" / "nostr"
 * / clone URL) to a concrete effective source in the process.
 *
 * Extracted from `RefSelector.tsx` so the same decoration logic can be reused
 * by the full-page `/branches` and `/tags` views.
 */

import { useMemo } from "react";
import type { NostrEvent } from "nostr-tools";
import type { GitRef } from "@/hooks/useGitExplorer";
import type { RepositoryState } from "@/casts/RepositoryState";
import type { PoolWarning, UrlState } from "@/lib/git-grasp-pool/types";
import { deriveEffectiveSource } from "@/lib/sourceUtils";
import {
  type RefWithStatus,
  getRefStatus,
  getRefStatusForServer,
  countMismatches,
} from "@/lib/refStatus";

export interface UseRefsWithStatusInput {
  /** All refs the explorer knows about (merged across servers). */
  refs: GitRef[];
  /**
   * The raw selected source: "default" | "nostr" | clone URL.  The hook
   * resolves "default" via `deriveEffectiveSource` and returns the result as
   * `effectiveSource` (never "default").
   */
  selectedSource: string;
  /** Winning Nostr state event, null if none found, undefined while loading. */
  repoState: RepositoryState | null | undefined;
  /** True once the relay EOSE has been received for the state query. */
  repoRelayEose: boolean;
  /** Per-relay state registry — used to detect "old-state" matches. */
  relayStateMap?: Map<string, NostrEvent>;
  /**
   * True when the git server is confirmed ahead of the Nostr-announced state.
   * Comes from `poolState.warning?.kind === "state-behind-git"`.
   */
  stateBehindGit: boolean;
  /** The pool warning (used to identify the ahead server). */
  poolWarning?: PoolWarning | null;
  /** Pool's winning git server clone URL. */
  winnerUrl?: string | null;
  /** Per-URL state from the pool. */
  urlStates: Record<string, UrlState>;
  /** All clone URLs declared by the repo. */
  cloneUrls: string[];
}

export interface UseRefsWithStatusResult {
  /** Resolved source — always "nostr" or a concrete clone URL, never "default". */
  effectiveSource: string;
  /** Every ref decorated with status against `effectiveSource`. */
  refsWithStatus: RefWithStatus[];
  /** Branches only (preserves merged order from `refs`). */
  branches: RefWithStatus[];
  /** Tags only (preserves merged order from `refs`). */
  tags: RefWithStatus[];
  /** Number of genuine mismatches (excludes state-behind). */
  mismatchCount: number;
  /**
   * Branch count per clone URL — `undefined` for servers whose infoRefs
   * haven't been fetched yet, `number` once known (including 0).
   */
  branchCountByUrl: Record<string, number | undefined>;
  /** Tag count per clone URL — same semantics as `branchCountByUrl`. */
  tagCountByUrl: Record<string, number | undefined>;
  /** Branches in the Nostr state, or `undefined` while state is loading / absent. */
  nostrBranchCount: number | undefined;
  /** Tags in the Nostr state, or `undefined` while state is loading / absent. */
  nostrTagCount: number | undefined;
}

// ---------------------------------------------------------------------------
// Per-URL counting helpers
// ---------------------------------------------------------------------------

/**
 * Count distinct branches in a server's infoRefs.  Each ref name is counted
 * once, ignoring peeled `^{}` entries which are present only for annotated
 * tags.
 */
function countRefsByPrefix(
  infoRefs: { refs: Record<string, string> },
  prefix: string,
): number {
  let n = 0;
  for (const name of Object.keys(infoRefs.refs)) {
    if (name.endsWith("^{}")) continue;
    if (name.startsWith(prefix)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRefsWithStatus({
  refs,
  selectedSource,
  repoState,
  repoRelayEose,
  relayStateMap,
  stateBehindGit,
  poolWarning,
  winnerUrl,
  urlStates,
  cloneUrls,
}: UseRefsWithStatusInput): UseRefsWithStatusResult {
  const isNoState = repoRelayEose && repoState === null;
  const aheadServerUrl =
    poolWarning?.kind === "state-behind-git" ? poolWarning.gitServerUrl : null;

  const effectiveSource = useMemo(
    () =>
      deriveEffectiveSource(
        selectedSource,
        stateBehindGit,
        isNoState,
        winnerUrl ?? null,
        aheadServerUrl,
      ),
    [selectedSource, stateBehindGit, isNoState, winnerUrl, aheadServerUrl],
  );

  // Compute status for each ref — against effectiveSource.
  // effectiveSource is always "nostr" or a concrete clone URL (never "default").
  const refsWithStatus: RefWithStatus[] = useMemo(() => {
    if (effectiveSource === "nostr") {
      // "nostr" (whether explicit or resolved from "default") compares directly
      // against the signed Nostr state. When the user explicitly selected
      // "nostr" (overriding a git-ahead situation), pass stateBehindGit=false
      // so refs are compared against the state even when the server is ahead.
      const behindGit = selectedSource === "nostr" ? false : stateBehindGit;
      return refs.map((ref) => ({
        ...ref,
        ...getRefStatus(
          ref,
          repoState,
          repoRelayEose,
          behindGit,
          urlStates,
          cloneUrls,
        ),
      }));
    }
    // A specific git server URL (explicit selection or resolved from "default")
    const serverUrlState = urlStates[effectiveSource];
    if (!serverUrlState?.infoRefs) {
      // Server not ready — fall back to nostr-state comparison
      return refs.map((ref) => ({
        ...ref,
        ...getRefStatus(
          ref,
          repoState,
          repoRelayEose,
          stateBehindGit,
          urlStates,
          cloneUrls,
        ),
      }));
    }
    return refs.map((ref) => ({
      ...ref,
      ...getRefStatusForServer(
        ref,
        serverUrlState,
        repoState,
        repoRelayEose,
        relayStateMap,
      ),
    }));
  }, [
    refs,
    repoState,
    repoRelayEose,
    stateBehindGit,
    urlStates,
    cloneUrls,
    effectiveSource,
    selectedSource,
    relayStateMap,
  ]);

  const branches = useMemo(
    () => refsWithStatus.filter((r) => r.isBranch),
    [refsWithStatus],
  );
  const tags = useMemo(
    () => refsWithStatus.filter((r) => r.isTag),
    [refsWithStatus],
  );

  const mismatchCount = useMemo(
    () => countMismatches(refsWithStatus),
    [refsWithStatus],
  );

  // Per-URL counts. `undefined` while infoRefs are still in flight so the
  // caller can render a skeleton; a concrete number (incl. 0) once known.
  const branchCountByUrl = useMemo(() => {
    const result: Record<string, number | undefined> = {};
    for (const url of cloneUrls) {
      const info = urlStates[url]?.infoRefs;
      result[url] = info ? countRefsByPrefix(info, "refs/heads/") : undefined;
    }
    return result;
  }, [cloneUrls, urlStates]);

  const tagCountByUrl = useMemo(() => {
    const result: Record<string, number | undefined> = {};
    for (const url of cloneUrls) {
      const info = urlStates[url]?.infoRefs;
      result[url] = info ? countRefsByPrefix(info, "refs/tags/") : undefined;
    }
    return result;
  }, [cloneUrls, urlStates]);

  const nostrBranchCount = useMemo(() => {
    if (repoState === undefined || !repoRelayEose) return undefined;
    if (repoState === null) return undefined;
    return repoState.refs.filter((r) => r.name.startsWith("refs/heads/"))
      .length;
  }, [repoState, repoRelayEose]);

  const nostrTagCount = useMemo(() => {
    if (repoState === undefined || !repoRelayEose) return undefined;
    if (repoState === null) return undefined;
    return repoState.refs.filter((r) => r.name.startsWith("refs/tags/")).length;
  }, [repoState, repoRelayEose]);

  return {
    effectiveSource,
    refsWithStatus,
    branches,
    tags,
    mismatchCount,
    branchCountByUrl,
    tagCountByUrl,
    nostrBranchCount,
    nostrTagCount,
  };
}
