/**
 * useBranchDivergence — compute ahead/behind vs the default branch plus the
 * latest commit metadata for a set of branches.
 *
 * Consumed by the full-page `/branches` view to render the ahead/behind
 * badges on each `RefRow` and the per-row commit message + timestamp.
 *
 * Strategy (for each non-default branch, in parallel — the pool handles
 * concurrency + caching internally):
 *
 *   1. `pool.findMergeBase(branch.hash)`         → merge-base commit hash
 *   2. `pool.getSingleCommit(branch.hash)`       → latest commit (for message
 *                                                  + author + timestamp)
 *   3. `pool.countCommitsBehind(mergeBase)`      → "behind" count (how many
 *                                                  commits the default branch
 *                                                  has past the merge base)
 *   4. `pool.getCommitHistory(branch.hash, 200)` → "ahead" count via the index
 *                                                  of the merge base in the
 *                                                  branch's commit chain.
 *                                                  This call is served from
 *                                                  the cache populated by
 *                                                  `findMergeBase` in step 1.
 *
 * When the merge base cannot be determined within the pool's 200-commit
 * walk, ahead/behind are returned as `null` (unknown).
 *
 * The hook returns a single `loading` / `error` / `divergence` snapshot that
 * is updated atomically once all branch lookups settle, so the UI does not
 * thrash row-by-row as commits stream in.
 *
 * A new `AbortController` is created for every parameter change and aborted
 * on unmount, so stale in-flight fetches never write to state.
 */

import { useEffect, useRef, useState } from "react";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
import type { RefWithStatus } from "@/lib/refStatus";
import type { BranchDivergence } from "@/components/RefRow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseBranchDivergenceResult {
  /** True while at least one branch is still being computed. */
  loading: boolean;
  /** Aggregate error message if the overall computation failed. */
  error: string | null;
  /**
   * Map from full ref name (`refs/heads/<branch>`) to its divergence vs the
   * default branch. Branches not present in the map are still computing.
   * The default branch is intentionally omitted (divergence vs itself is 0).
   */
  divergence: Map<string, BranchDivergence>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Reactive lookup of ahead/behind divergence for a set of branches.
 *
 * @param pool          - The git pool for the repo. While `null` the hook is
 *                        idle and the returned divergence map is empty.
 * @param branches      - All branches to consider; the default branch is
 *                        filtered out internally.
 * @param defaultBranch - The default branch (used to recognise which entry
 *                        in `branches` to skip).
 */
export function useBranchDivergence(
  pool: GitGraspPool | null,
  branches: RefWithStatus[],
  defaultBranch: RefWithStatus | undefined,
): UseBranchDivergenceResult {
  const [state, setState] = useState<UseBranchDivergenceResult>({
    loading: false,
    error: null,
    divergence: new Map(),
  });
  const abortRef = useRef<AbortController | null>(null);

  // Build a stable key so we don't re-run when the branches array reference
  // changes but its contents are identical.
  const targets = branches.filter((b) => !b.isDefault);
  const targetsKey = targets
    .map((b) => `${b.name}:${b.hash}`)
    .sort()
    .join("|");
  // infoRefs presence has to be part of the key — otherwise the hook would
  // latch into "loading" the first time it runs and never re-fire when the
  // pool finally publishes its initial infoRefs response.
  const hasInfoRefs = pool ? !!pool.getInfoRefs() : false;
  const depKey = `${pool ? "p" : "n"}|${hasInfoRefs ? "r" : "-"}|${defaultBranch?.hash ?? ""}|${targetsKey}`;

  useEffect(() => {
    // Always cancel any in-flight computation when inputs change.
    abortRef.current?.abort();

    if (!pool || !defaultBranch || targets.length === 0) {
      setState({ loading: false, error: null, divergence: new Map() });
      return;
    }

    // findMergeBase / countCommitsBehind both require infoRefs. Surface a
    // loading state until they arrive — the depKey above includes
    // `hasInfoRefs`, so the effect re-runs once the pool's initial response
    // lands.
    if (!hasInfoRefs) {
      setState({ loading: true, error: null, divergence: new Map() });
      return;
    }

    const abort = new AbortController();
    abortRef.current = abort;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    Promise.all(
      targets.map(
        async (branch): Promise<[string, BranchDivergence] | null> => {
          const fullRefName = `refs/heads/${branch.name}`;
          try {
            // Fast path: identical to the default branch.
            if (branch.hash === defaultBranch.hash) {
              const latestCommit = await pool.getSingleCommit(
                branch.hash,
                abort.signal,
              );
              if (abort.signal.aborted) return null;
              return [
                fullRefName,
                {
                  ahead: 0,
                  behind: 0,
                  latestCommit,
                  noMergeBase: false,
                },
              ];
            }

            // Step 1+2: merge base + latest commit, in parallel. findMergeBase
            // populates the branch's 200-commit history in the cache as a
            // side effect, which step 4 below relies on.
            const [mergeBase, latestCommit] = await Promise.all([
              pool.findMergeBase(branch.hash, abort.signal),
              pool.getSingleCommit(branch.hash, abort.signal),
            ]);
            if (abort.signal.aborted) return null;

            // No shared ancestor within the pool's commit walk — surface
            // explicitly as `noMergeBase` so the row renders "orphaned"
            // rather than just blank/unknown.
            if (mergeBase === null) {
              return [
                fullRefName,
                {
                  ahead: null,
                  behind: null,
                  latestCommit,
                  noMergeBase: true,
                },
              ];
            }

            let ahead: number | null = null;
            let behind: number | null = null;

            // Step 3: how far the default branch is past the merge base.
            behind = await pool.countCommitsBehind(mergeBase, abort.signal);
            if (abort.signal.aborted) return null;

            // Step 4: how far this branch is past the merge base. Served
            // from the cache populated by findMergeBase above.
            if (mergeBase === branch.hash) {
              ahead = 0;
            } else {
              const chain = await pool.getCommitHistory(
                branch.hash,
                200,
                abort.signal,
              );
              if (abort.signal.aborted) return null;
              if (chain) {
                const idx = chain.findIndex((c) => c.hash === mergeBase);
                if (idx !== -1) ahead = idx;
              }
            }

            const value: BranchDivergence = {
              ahead,
              behind,
              latestCommit,
              noMergeBase: false,
            };
            return [fullRefName, value];
          } catch {
            if (abort.signal.aborted) return null;
            // Per-branch failures degrade gracefully — surface "unknown"
            // counts so the row still renders. We deliberately leave
            // `noMergeBase` unset here so transient fetch errors don't
            // masquerade as orphaned branches in the UI.
            return [
              fullRefName,
              { ahead: null, behind: null, latestCommit: null },
            ];
          }
        },
      ),
    )
      .then((results) => {
        if (abort.signal.aborted) return;
        const map = new Map<string, BranchDivergence>();
        for (const entry of results) {
          if (entry) map.set(entry[0], entry[1]);
        }
        setState({ loading: false, error: null, divergence: map });
      })
      .catch((e: unknown) => {
        if (abort.signal.aborted) return;
        const message =
          e instanceof Error
            ? e.message
            : "Failed to compute branch divergence";
        setState({ loading: false, error: message, divergence: new Map() });
      });

    return () => {
      abort.abort();
    };
    // depKey already encodes pool identity, default branch, and the (name, hash)
    // tuples for every non-default branch — that's everything we depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  return state;
}
