/**
 * Pure helpers for computing ref status against the Nostr-signed repository
 * state (kind:30618) and the pool's per-URL `refStatus` view.
 *
 * Extracted from `src/components/RefSelector.tsx` so the same logic can be
 * reused by the full-page `/branches` and `/tags` views.  Behaviour is
 * intentionally identical to the originals — moving only.
 */

import type { NostrEvent } from "nostr-tools";
import type { GitRef } from "@/hooks/useGitExplorer";
import type { RepositoryState } from "@/casts/RepositoryState";
import { isValidRepositoryState } from "@/casts/RepositoryState";
import { getStateRefs } from "@/lib/nip34";
import type { UrlState, UrlRefStatus } from "@/lib/git-grasp-pool/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Status of a ref's verification against the signed state event.
 *
 * - "verified"        : state event exists and this ref's commit matches
 * - "mismatch"        : state event exists but declares a different commit for this ref
 * - "old-state"       : ref matches a previously-signed (older) Nostr state from this relay
 * - "state-behind"    : git server is ahead of the signed state (expected lag, not suspicious)
 * - "git-server-only" : state event exists but doesn't include this ref
 * - "not-on-server"   : ref doesn't exist on the selected git server source
 * - "no-state"        : no state event was found (after EOSE)
 * - "loading"         : still waiting for state event data
 */
export type RefStatus =
  | "verified"
  | "mismatch"
  | "old-state"
  | "state-behind"
  | "git-server-only"
  | "not-on-server"
  | "no-state"
  | "loading";

export interface RefWithStatus extends GitRef {
  status: RefStatus;
  /** Commit declared by winning state event (if different) */
  stateCommit?: string;
  /**
   * Actual commit on the selected git server (may differ from ref.hash,
   * which is the winning server's hash).
   */
  serverCommit?: string;
  /** Commit declared by the older relay-specific state (for "old-state") */
  oldStateCommit?: string;
  /** created_at of the older relay-specific state event */
  oldStateCreatedAt?: number;
}

// ---------------------------------------------------------------------------
// Tag-version sort
// ---------------------------------------------------------------------------

/**
 * Parse a tag name into a comparable semver-like tuple.
 * Strips a leading "v" or "V", then splits on dots.
 * Returns null if the name doesn't look like a version string.
 */
function parseTagVersion(name: string): number[] | null {
  const stripped = name.replace(/^[vV]/, "");
  // Must start with a digit to be treated as a version
  if (!/^\d/.test(stripped)) return null;
  // Split on dots and parse each segment as an integer (ignore pre-release suffix)
  const parts = stripped.split(".");
  const nums = parts.map((p) => {
    const n = parseInt(p, 10);
    return isNaN(n) ? 0 : n;
  });
  return nums;
}

/**
 * Compare two tag names for sorting, newest first.
 * Semver-like names (e.g. v1.2.3) are compared numerically in descending
 * order. Non-version names fall back to reverse lexicographic order.
 */
export function compareTagsNewestFirst(a: string, b: string): number {
  const av = parseTagVersion(a);
  const bv = parseTagVersion(b);

  if (av && bv) {
    const len = Math.max(av.length, bv.length);
    for (let i = 0; i < len; i++) {
      const ai = av[i] ?? 0;
      const bi = bv[i] ?? 0;
      if (ai !== bi) return bi - ai; // descending
    }
    return 0;
  }

  // One or both are non-version — fall back to reverse lexicographic
  return b.localeCompare(a);
}

// ---------------------------------------------------------------------------
// Commit-hash matching
// ---------------------------------------------------------------------------

/**
 * Loose commit-hash match: equal, or one is a prefix of the other.
 * Used because state events may store either the full SHA or a short hash.
 */
export function commitsMatch(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

// ---------------------------------------------------------------------------
// Older relay state lookup
// ---------------------------------------------------------------------------

/**
 * Search all relay state events for any older (previously-signed) state event
 * that differs from the winning state. Returns the most recent such event, or
 * undefined if every relay is already serving the winning state.
 *
 * Searching all relays (not just the one associated with the server's clone URL)
 * means we catch the case where multiple relays hold different older versions —
 * the server's commit just needs to match any of them.
 */
export function findOlderStateEvent(
  relayStateMap: Map<string, NostrEvent>,
  winningState: RepositoryState,
): NostrEvent | undefined {
  let best: NostrEvent | undefined;
  for (const event of relayStateMap.values()) {
    // Skip if this IS the winning event
    if (event.id === winningState.event.id) continue;
    // Skip if it's not actually older than the winner
    if (
      event.created_at > winningState.event.created_at ||
      (event.created_at === winningState.event.created_at &&
        event.id >= winningState.event.id)
    ) {
      continue;
    }
    // Keep the most recent older event as the best candidate
    if (
      !best ||
      event.created_at > best.created_at ||
      (event.created_at === best.created_at && event.id > best.id)
    ) {
      best = event;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ref-status computation
// ---------------------------------------------------------------------------

export function getRefStatus(
  ref: GitRef,
  repoState: RepositoryState | null | undefined,
  repoRelayEose: boolean,
  stateBehindGit: boolean,
  urlStates: Record<string, UrlState>,
  cloneUrls: string[],
): { status: RefStatus; stateCommit?: string } {
  // Still loading state event data
  if (repoState === undefined || !repoRelayEose) {
    return { status: "loading" };
  }

  // No state event found
  if (repoState === null) {
    return { status: "no-state" };
  }

  // Find this ref in the state event
  const prefix = ref.isBranch ? "refs/heads/" : "refs/tags/";
  const fullRefName = `${prefix}${ref.name}`;
  const stateRef = repoState.refs.find((r) => r.name === fullRefName);

  if (!stateRef) {
    // This ref exists on the git server but has never been published to the
    // Nostr state — always flag it as git-server-only, even when the git
    // server is ahead of the signed state on the default branch.
    return { status: "git-server-only" };
  }

  // When the git server is confirmed ahead of the signed state, the default
  // branch is always "state-behind" — even if its hash happens to match the
  // state ref, the HEAD comparison already proved the server is ahead.
  if (stateBehindGit && ref.isDefault) {
    return { status: "state-behind", stateCommit: stateRef.commitId };
  }

  // Use the pool's pre-computed per-URL ref statuses as the authoritative
  // source. The pool already handles annotated tag peeling, old-ngit OID
  // fallback, and cross-server discrepancies — re-computing here from only
  // the winner's infoRefs would miss servers that are behind the state.
  //
  // Collect statuses for this ref across all ok servers.
  const serverStatuses = cloneUrls
    .map((url) => urlStates[url]?.refStatus[fullRefName])
    .filter((s): s is UrlRefStatus => s !== undefined);

  if (serverStatuses.length > 0) {
    // If any server is behind or ahead of the state, surface as mismatch.
    const hasMismatch = serverStatuses.some(
      (s) => s === "behind" || s === "ahead",
    );
    if (hasMismatch) {
      if (stateBehindGit)
        return { status: "state-behind", stateCommit: stateRef.commitId };
      return { status: "mismatch", stateCommit: stateRef.commitId };
    }

    // All servers that have reported are "match" (or "connected"/"error" which
    // we ignore for verification purposes) and at least one confirmed match.
    const anyMatch = serverStatuses.some((s) => s === "match");
    const allSettled = serverStatuses.every(
      (s) => s === "match" || s === "error" || s === "connected",
    );
    if (allSettled && anyMatch) {
      return { status: "verified" };
    }

    // If not all pending (unknown/connected), fall through to the state
    // comparison below so we show something useful while the pool fetches.
  }

  // Fallback: pool hasn't computed refStatus yet (infoRefs still in flight).
  // Compare the winner's commit directly against the state event.
  if (commitsMatch(ref.hash, stateRef.commitId)) {
    return { status: "verified" };
  }

  // Older ngit versions stored the tag object OID in the state event instead
  // of the peeled commit. The pool handles this the same way (pool.ts:183-189).
  // If the state's commitId matches the raw tag object OID, treat as verified.
  if (ref.rawTagOid && commitsMatch(ref.rawTagOid, stateRef.commitId)) {
    return { status: "verified" };
  }

  // When the git server is confirmed ahead of the signed state, a commit
  // difference on any other ref is expected — use a softer status.
  if (stateBehindGit)
    return { status: "state-behind", stateCommit: stateRef.commitId };

  return { status: "mismatch", stateCommit: stateRef.commitId };
}

/**
 * Compute ref status when a specific git server is selected as the source.
 * Nostr state is still the authority — we compare this server's commit
 * against the Nostr state, but only using data from this one server.
 * Refs absent from this server get "not-on-server".
 *
 * When the server's commit doesn't match the winning state but matches a
 * previously-signed (older) state event from that server's relay, the status
 * is "old-state" rather than "mismatch".
 */
export function getRefStatusForServer(
  ref: GitRef,
  serverUrlState: UrlState,
  repoState: RepositoryState | null | undefined,
  repoRelayEose: boolean,
  relayStateMap?: Map<string, NostrEvent>,
): {
  status: RefStatus;
  stateCommit?: string;
  serverCommit?: string;
  oldStateCommit?: string;
  oldStateCreatedAt?: number;
} {
  const prefix = ref.isBranch ? "refs/heads/" : "refs/tags/";
  const fullRefName = `${prefix}${ref.name}`;
  const peeledRefName = `${fullRefName}^{}`;

  // Check if this ref exists on the selected server
  const serverCommit =
    serverUrlState.infoRefs?.refs[peeledRefName] ??
    serverUrlState.infoRefs?.refs[fullRefName];

  if (!serverCommit) {
    return { status: "not-on-server" };
  }

  // Nostr state still loading
  if (repoState === undefined || !repoRelayEose) {
    return { status: "loading" };
  }

  // No Nostr state
  if (repoState === null) {
    return { status: "no-state" };
  }

  // Find this ref in the Nostr state
  const stateRef = repoState.refs.find((r) => r.name === fullRefName);
  if (!stateRef) {
    return { status: "git-server-only" };
  }

  // Use the pool's pre-computed refStatus for this server if available
  const poolStatus = serverUrlState.refStatus[fullRefName];
  if (poolStatus === "match") return { status: "verified" };
  if (poolStatus === "behind" || poolStatus === "ahead") {
    // Check if this server's commit matches any older signed state event
    const oldState = relayStateMap
      ? findOlderStateEvent(relayStateMap, repoState)
      : undefined;
    if (oldState && isValidRepositoryState(oldState)) {
      const oldStateRefs = getStateRefs(oldState);
      const oldStateRef = oldStateRefs.find((r) => r.name === fullRefName);
      if (oldStateRef && commitsMatch(serverCommit, oldStateRef.commitId)) {
        return {
          status: "old-state",
          stateCommit: stateRef.commitId,
          serverCommit,
          oldStateCommit: oldStateRef.commitId,
          oldStateCreatedAt: oldState.created_at,
        };
      }
    }
    return { status: "mismatch", stateCommit: stateRef.commitId, serverCommit };
  }

  // Fallback: direct commit comparison
  if (commitsMatch(serverCommit, stateRef.commitId)) {
    return { status: "verified" };
  }

  if (ref.rawTagOid && commitsMatch(ref.rawTagOid, stateRef.commitId)) {
    return { status: "verified" };
  }

  // Check for old-state match before declaring mismatch
  if (relayStateMap) {
    const oldState = findOlderStateEvent(relayStateMap, repoState);
    if (oldState && isValidRepositoryState(oldState)) {
      const oldStateRefs = getStateRefs(oldState);
      const oldStateRef = oldStateRefs.find((r) => r.name === fullRefName);
      if (oldStateRef && commitsMatch(serverCommit, oldStateRef.commitId)) {
        return {
          status: "old-state",
          stateCommit: stateRef.commitId,
          serverCommit,
          oldStateCommit: oldStateRef.commitId,
          oldStateCreatedAt: oldState.created_at,
        };
      }
    }
  }

  return { status: "mismatch", stateCommit: stateRef.commitId, serverCommit };
}

export function countMismatches(refsWithStatus: RefWithStatus[]): number {
  return refsWithStatus.filter((r) => r.status === "mismatch").length;
}
