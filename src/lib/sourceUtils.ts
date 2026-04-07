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
 * on the currently selected source.
 *
 * @param selectedSource  "default" | "nostr" | clone URL string
 * @param urlStates       Per-URL state from poolState.urls
 * @param repoState       Winning Nostr state event (null = no state, undefined = loading)
 * @param stateBehindGit  True when the git server is confirmed ahead of the Nostr state
 * @param currentRef      Short ref name currently being viewed (e.g. "main", "v1.0.0")
 * @param currentRefIsBranch  Whether currentRef is a branch (vs tag)
 */
export function deriveEffectiveHeadCommit(
  selectedSource: string,
  urlStates: Record<string, UrlState>,
  repoState: RepositoryState | null | undefined,
  stateBehindGit: boolean,
  currentRef: string | null | undefined,
  currentRefIsBranch: boolean,
): string | undefined {
  if (selectedSource === "default") {
    // Standard pool logic: when git server is ahead, let the explorer use the
    // default branch (undefined knownHeadCommit). Otherwise use Nostr state.
    if (stateBehindGit) return undefined;
    return repoState?.headCommitId;
  }

  if (selectedSource === "nostr") {
    // Explicit Nostr override — use the Nostr state's HEAD commit.
    return repoState?.headCommitId;
  }

  // A specific git server URL is selected — use that server's commit for the
  // current ref so the explorer shows that server's tree/history.
  if (currentRef) {
    const serverState = urlStates[selectedSource];
    if (serverState?.infoRefs) {
      const commit = resolveRefCommitFromInfoRefs(
        serverState.infoRefs,
        currentRef,
        currentRefIsBranch,
      );
      if (commit) return commit;
    }
  }

  // Server not ready yet or ref not found on server — fall back to default.
  if (stateBehindGit) return undefined;
  return repoState?.headCommitId;
}
