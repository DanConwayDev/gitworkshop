/**
 * useCIForPR — reactive CI checks (ngit-ci kinds 9841/9842) for a PR.
 *
 * Store-read only — no relay subscriptions of its own. The events arrive
 * via the pre-wired loaders:
 *  - kind:9842 results tag the PR root with NIP-22-style #E, so
 *    nip34CommentsLoader (fired for every repo item by nip34RepoLoader, and
 *    again by useNip34ItemLoader on detail pages) fetches them.
 *  - kind:9841 running markers are fetched repo-wide via the #a coordinate
 *    filter in nip34RepoLoader's repo meta subscription (they carry a NIP-40
 *    expiration, so the live set stays small).
 *
 * No trust filtering is applied — all runner identities are displayed and
 * the UI shows who signed each result.
 */

import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import { combineLatest, timer } from "rxjs";
import { map } from "rxjs/operators";
import { CIRun, isValidCIRun } from "@/casts/CIRun";
import { CIResult, isValidCIResult } from "@/casts/CIResult";
import {
  CI_RUN_KIND,
  CI_RESULT_KIND,
  groupCIWorkflowRuns,
  splitRunsByCommit,
  rollupCIStatuses,
  type CIWorkflowRun,
  type CICheckStatus,
} from "@/lib/ci";

/** Re-evaluate expirations of kind:9841 running markers this often. */
const EXPIRY_RECHECK_INTERVAL_MS = 30_000;

export interface PRCIChecks {
  /** All workflow runs referencing the PR root, most recent first. */
  runs: CIWorkflowRun[];
  /**
   * Runs for the PR's tip commit (or, when the tip is unknown, the commit
   * with the most recent CI activity).
   */
  currentRuns: CIWorkflowRun[];
  /** Runs for superseded commits (earlier revisions). */
  olderRuns: CIWorkflowRun[];
  /** Rolled-up status across currentRuns — undefined when there are none. */
  status: CICheckStatus | undefined;
}

/**
 * Reactively resolve CI checks for a PR (or patch) root event.
 *
 * @param prRootId    - Event id of the kind:1618 PR (or 1617 patch) root
 * @param tipCommitId - The current tip commit, when known (detail pages) —
 *                      used to split current vs. superseded-revision runs
 */
export function useCIForPR(
  prRootId: string | undefined,
  tipCommitId?: string,
): PRCIChecks | undefined {
  const store = useEventStore();

  const runs = use$(() => {
    if (!prRootId) return undefined;
    const castStore = store as unknown as CastRefEventStore;

    const results$ = store.timeline([
      { kinds: [CI_RESULT_KIND], "#E": [prRootId] } as Filter,
    ]);
    const runMarkers$ = store.timeline([
      { kinds: [CI_RUN_KIND], "#E": [prRootId] } as Filter,
    ]);

    // The timer re-runs grouping periodically so pending markers disappear
    // when their NIP-40 expiration passes without any new event arriving.
    return combineLatest([
      results$,
      runMarkers$,
      timer(0, EXPIRY_RECHECK_INTERVAL_MS),
    ]).pipe(
      map(([resultEvents, runEvents]) => {
        const results: CIResult[] = [];
        for (const ev of resultEvents as NostrEvent[]) {
          if (!isValidCIResult(ev)) continue;
          try {
            results.push(new CIResult(ev, castStore));
          } catch {
            // Malformed event — skip
          }
        }
        const markers: CIRun[] = [];
        for (const ev of runEvents as NostrEvent[]) {
          if (!isValidCIRun(ev)) continue;
          try {
            markers.push(new CIRun(ev, castStore));
          } catch {
            // Malformed event — skip
          }
        }
        return groupCIWorkflowRuns(markers, results);
      }),
    );
  }, [prRootId, store]);

  return useMemo(() => {
    if (!runs) return undefined;
    const { current, older } = splitRunsByCommit(runs, tipCommitId);
    return {
      runs,
      currentRuns: current,
      olderRuns: older,
      status: rollupCIStatuses(current.map((r) => r.status)),
    };
  }, [runs, tipCommitId]);
}
