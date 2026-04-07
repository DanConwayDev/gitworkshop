/**
 * Utilities for deriving the effective HEAD commit from a selected source.
 *
 * The "source" is the user-chosen verification/display source in RefSelector:
 *   "default" — pool-decided (git server when ahead, Nostr state otherwise)
 *   "nostr"   — explicit Nostr state override
 *   <url>     — a specific git server clone URL
 *
 * When a specific server is selected, the explorer should show that server's
 * commit for the current ref rather than the Nostr state commit.
 */

import type { UrlState } from "@/lib/git-grasp-pool/types";
import type { RepositoryState } from "@/casts/RepositoryState";

/**
 * Resolve the raw `selectedSource` value ("default" | "nostr" | URL) into a
 * concrete effective source that is always either `"nostr"` or a clone URL
 * string.  Callers should use this resolved value for all display and data
 * logic so that "default" never leaks into downstream components.
 *
 * Resolution rules for "default":
 *   - git server is ahead of Nostr state  → the winning git server URL
 *   - no Nostr state published             → the winning git server URL (or
 *                                            "nostr" if no winner is known)
 *   - otherwise                            → "nostr"
 *
 * "nostr" and explicit URLs are returned unchanged.
 *
 * @param selectedSource  Raw source value from URL params / component state
 * @param stateBehindGit  True when the git server is confirmed ahead of Nostr
 * @param isNoState       True when EOSE received but no Nostr state exists
 * @param winnerUrl       Clone URL of the pool's winning git server, if known
 */
export function deriveEffectiveSource(
  selectedSource: string,
  stateBehindGit: boolean,
  isNoState: boolean,
  winnerUrl: string | null | undefined,
): string {
  if (selectedSource !== "default") {
    // "nostr" or an explicit URL — return as-is
    return selectedSource;
  }

  // "default" resolution
  if (stateBehindGit || isNoState) {
    return winnerUrl ?? "nostr";
  }

  return "nostr";
}

/**
 * Resolve the commit hash for a given ref from a server's infoRefs,
 * peeling annotated tags via the `^{}` entry when present.
 */
function resolveRefCommitFromInfoRefs(
  infoRefs: { refs: Record<string, string> },
  refName: string,
  isBranch: boolean,
): string | undefined {
  const prefix = isBranch ? "refs/heads/" : "refs/tags/";
  const fullRefName = `${prefix}${refName}`;
  // Peeled annotated tag commit takes priority over the tag object OID.
  return infoRefs.refs[`${fullRefName}^{}`] ?? infoRefs.refs[fullRefName];
}

/**
 * Derive the effective `knownHeadCommit` to pass to `useGitExplorer` based
 * on the effective (already-resolved) source.
 *
 * Callers should pass the result of `deriveEffectiveSource()` — never the raw
 * "default" sentinel — so this function only needs to handle "nostr" or a URL.
 *
 * @param effectiveSource  "nostr" | clone URL string (resolved, never "default")
 * @param urlStates        Per-URL state from poolState.urls
 * @param repoState        Winning Nostr state event (null = no state, undefined = loading)
 * @param stateBehindGit   True when the git server is confirmed ahead of the Nostr state
 * @param currentRef       Short ref name currently being viewed (e.g. "main", "v1.0.0")
 * @param currentRefIsBranch  Whether currentRef is a branch (vs tag)
 */
export function deriveEffectiveHeadCommit(
  effectiveSource: string,
  urlStates: Record<string, UrlState>,
  repoState: RepositoryState | null | undefined,
  stateBehindGit: boolean,
  currentRef: string | null | undefined,
  currentRefIsBranch: boolean,
): string | undefined {
  if (effectiveSource === "nostr") {
    // Nostr state is the authority — use its HEAD commit.
    // When the git server is ahead and we're still on nostr, let the explorer
    // use the default branch (undefined knownHeadCommit).
    if (stateBehindGit) return undefined;
    return repoState?.headCommitId;
  }

  // A specific git server URL — use that server's commit for the current ref
  // so the explorer shows that server's tree/history.
  if (currentRef) {
    const serverState = urlStates[effectiveSource];
    if (serverState?.infoRefs) {
      const commit = resolveRefCommitFromInfoRefs(
        serverState.infoRefs,
        currentRef,
        currentRefIsBranch,
      );
      if (commit) return commit;
    }
  }

  // Server not ready yet or ref not found on server — fall back gracefully.
  if (stateBehindGit) return undefined;
  return repoState?.headCommitId;
}
