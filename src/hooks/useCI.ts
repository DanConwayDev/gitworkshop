/**
 * CI check hooks — reactive ngit-ci workflow checks (kinds 9841/9842).
 *
 * useCIForPR — checks for a PR/patch root event. Store-read only; events
 * arrive via the pre-wired loaders:
 *  - kind:9842 results tag the PR root with NIP-22-style #E, so
 *    nip34CommentsLoader (fired for every repo item by nip34RepoLoader, and
 *    again by useNip34ItemLoader on detail pages) fetches them.
 *  - kind:9841 running markers are fetched repo-wide via the #a coordinate
 *    filter in nip34RepoLoader's repo meta subscription (they carry a NIP-40
 *    expiration, so the live set stays small).
 *
 * useCIForCommits / useCIForCommit — checks for specific commits (CodeBar
 * head commit, commit history rows, commit detail page). These fire the
 * ciResultsByCommitLoader (#c tag) for each commit being displayed — calls
 * within the buffer window batch into one REQ per relay — and read both
 * kinds back from the store by #c.
 *
 * useRepoCI — repo-wide workflow runs for the Actions tab. Fires a live
 * #a subscription for both kinds against the repo relay group and reads
 * them back from the store.
 *
 * useRepoHasCI — cheap presence probe (limit-1 one-shot request) used to
 * decide whether to show the Actions tab at all.
 *
 * Multi-maintainer repos are announced under one coordinate per maintainer
 * and CI events may carry multiple `a` tags — every #a filter here takes the
 * repo's full coordinate set (repo.allCoordinates).
 *
 * No trust filtering is applied — all runner identities are displayed and
 * the UI shows who signed each result.
 */

import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import type { Filter } from "applesauce-core/helpers";
import type { RelayGroup } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";
import { combineLatest, timer, merge, EMPTY } from "rxjs";
import { map, catchError } from "rxjs/operators";
import { CIRun, isValidCIRun } from "@/casts/CIRun";
import { CIJobResultEvent, isValidCIJobResult } from "@/casts/CIJobResult";
import { CIResult, isValidCIResult } from "@/casts/CIResult";
import { ciResultsByCommitLoader, pool } from "@/services/nostr";
import {
  resilientRequest,
  resilientSubscription,
} from "@/lib/resilientSubscription";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { relayGroupUrls$ } from "@/models/RepositoryRelayGroup";
import {
  CI_RUN_KIND,
  CI_RESULT_KIND,
  CI_JOB_RESULT_KIND,
  CI_EVENT_KINDS,
  groupCIWorkflowRuns,
  splitRunsByCommit,
  rollupCIStatuses,
  type CIWorkflowRun,
  type CICheckStatus,
} from "@/lib/ci";

/** Re-evaluate expirations of kind:9841 running markers this often. */
const EXPIRY_RECHECK_INTERVAL_MS = 30_000;

/** Cast raw store events into CI casts and group them into workflow runs. */
function castAndGroupCIEvents(
  resultEvents: NostrEvent[],
  runEvents: NostrEvent[],
  jobEvents: NostrEvent[],
  castStore: CastRefEventStore,
): CIWorkflowRun[] {
  const results: CIResult[] = [];
  for (const ev of resultEvents) {
    if (!isValidCIResult(ev)) continue;
    try {
      results.push(new CIResult(ev, castStore));
    } catch {
      // Malformed event — skip
    }
  }
  const markers: CIRun[] = [];
  for (const ev of runEvents) {
    if (!isValidCIRun(ev)) continue;
    try {
      markers.push(new CIRun(ev, castStore));
    } catch {
      // Malformed event — skip
    }
  }
  const jobs: CIJobResultEvent[] = [];
  for (const ev of jobEvents) {
    if (!isValidCIJobResult(ev)) continue;
    try {
      jobs.push(new CIJobResultEvent(ev, castStore));
    } catch {
      // Malformed event — skip
    }
  }
  return groupCIWorkflowRuns(markers, results, jobs);
}

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
    const jobs$ = store.timeline([
      { kinds: [CI_JOB_RESULT_KIND], "#E": [prRootId] } as Filter,
    ]);

    // The timer re-runs grouping periodically so pending markers disappear
    // when their NIP-40 expiration passes without any new event arriving.
    return combineLatest([
      results$,
      runMarkers$,
      jobs$,
      timer(0, EXPIRY_RECHECK_INTERVAL_MS),
    ]).pipe(
      map(([resultEvents, runEvents, jobEvents]) =>
        castAndGroupCIEvents(
          resultEvents as NostrEvent[],
          runEvents as NostrEvent[],
          jobEvents as NostrEvent[],
          castStore,
        ),
      ),
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

// ---------------------------------------------------------------------------
// Per-commit checks
// ---------------------------------------------------------------------------

export interface CommitCIChecks {
  /** All workflow runs for the commit, most recent first. */
  runs: CIWorkflowRun[];
  /** Rolled-up status across the commit's runs. */
  status: CICheckStatus | undefined;
}

/**
 * Reactively resolve CI checks for a batch of commits — e.g. a page of
 * commit history rows.
 *
 * Fires ciResultsByCommitLoader (#c) for each commit against the repo relay
 * group; the singleton loader batches calls within its buffer window into a
 * single REQ per relay. Kind:9841 running markers are read from the store
 * (they arrive via the repo-wide #a subscription in nip34RepoLoader).
 *
 * Returns a map of commit id → checks; commits with no CI events are absent.
 *
 * @param commitIds      - Commit hashes about to be displayed
 * @param repoRelayGroup - Repo relay group from useResolvedRepository
 */
export function useCIForCommits(
  commitIds: string[],
  repoRelayGroup: RelayGroup | undefined,
): Map<string, CommitCIChecks> | undefined {
  const store = useEventStore();

  // Stable key — re-subscribes only when the set of commits actually changes
  const idsKey = [...commitIds].sort().join(",");

  // Reactive relay list — re-fires the loader when the group gains relays
  const relays =
    use$(() => relayGroupUrls$(repoRelayGroup), [repoRelayGroup]) ?? [];
  const relayKey = relays.join(",");

  // Fire the #c results loader for each commit (batched by the singleton).
  use$(() => {
    if (commitIds.length === 0 || relays.length === 0) return undefined;
    return merge(
      ...commitIds.map((c) => ciResultsByCommitLoader({ value: c, relays })),
    ).pipe(catchError(() => EMPTY));
  }, [idsKey, relayKey]);

  // Read all CI kinds back from the store by #c.
  const runs = use$(() => {
    if (commitIds.length === 0) return undefined;
    const castStore = store as unknown as CastRefEventStore;

    const results$ = store.timeline([
      { kinds: [CI_RESULT_KIND], "#c": commitIds } as Filter,
    ]);
    const runMarkers$ = store.timeline([
      { kinds: [CI_RUN_KIND], "#c": commitIds } as Filter,
    ]);
    const jobs$ = store.timeline([
      { kinds: [CI_JOB_RESULT_KIND], "#c": commitIds } as Filter,
    ]);

    return combineLatest([
      results$,
      runMarkers$,
      jobs$,
      timer(0, EXPIRY_RECHECK_INTERVAL_MS),
    ]).pipe(
      map(([resultEvents, runEvents, jobEvents]) =>
        castAndGroupCIEvents(
          resultEvents as NostrEvent[],
          runEvents as NostrEvent[],
          jobEvents as NostrEvent[],
          castStore,
        ),
      ),
    );
  }, [idsKey, store]);

  return useMemo(() => {
    if (!runs) return undefined;
    const byCommit = new Map<string, CommitCIChecks>();
    for (const run of runs) {
      if (!run.commitId) continue;
      let entry = byCommit.get(run.commitId);
      if (!entry) {
        entry = { runs: [], status: undefined };
        byCommit.set(run.commitId, entry);
      }
      entry.runs.push(run);
    }
    for (const entry of byCommit.values()) {
      entry.status = rollupCIStatuses(entry.runs.map((r) => r.status));
    }
    return byCommit;
  }, [runs]);
}

/**
 * Reactively resolve CI checks for a single commit (CodeBar head commit,
 * commit detail page). Convenience wrapper around useCIForCommits.
 */
export function useCIForCommit(
  commitId: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
): CommitCIChecks | undefined {
  const ids = useMemo(() => (commitId ? [commitId] : []), [commitId]);
  const checks = useCIForCommits(ids, repoRelayGroup);
  return commitId ? checks?.get(commitId) : undefined;
}

// ---------------------------------------------------------------------------
// Repo-wide checks (Actions tab)
// ---------------------------------------------------------------------------

/**
 * Reactively resolve all CI workflow runs for a repository — the data source
 * for the repo Actions tab.
 *
 * Fires a live #a subscription for both kinds against the repo relay group
 * (CI events on multi-maintainer repos may tag any of the repo's
 * coordinates, so the full coordinate set is passed) and reads them back
 * from the store grouped into workflow runs, most recent first.
 *
 * @param repoCoords     - The repo's full coordinate set (repo.allCoordinates)
 * @param repoRelayGroup - Repo relay group from useResolvedRepository
 */
export function useRepoCI(
  repoCoords: string[] | undefined,
  repoRelayGroup: RelayGroup | undefined,
): CIWorkflowRun[] | undefined {
  const store = useEventStore();

  // Stable key — re-subscribes only when the coordinate set actually changes
  const coordsKey = repoCoords ? [...repoCoords].sort().join(",") : "";

  // Reactive relay list — re-fires the subscription when the group gains relays
  const relays =
    use$(() => relayGroupUrls$(repoRelayGroup), [repoRelayGroup]) ?? [];
  const relayKey = relays.join(",");

  // Layer 1: fetch CI activity repo-wide by #a.
  use$(() => {
    if (!repoCoords || repoCoords.length === 0 || relays.length === 0)
      return undefined;
    return resilientSubscription(pool, relays, [
      { kinds: [...CI_EVENT_KINDS], "#a": repoCoords } as Filter,
    ]).pipe(
      onlyEvents(),
      mapEventsToStore(store),
      catchError(() => EMPTY),
    );
  }, [coordsKey, relayKey, store]);

  // Layer 2: read all CI kinds back from the store and group.
  return use$(() => {
    if (!repoCoords || repoCoords.length === 0) return undefined;
    const castStore = store as unknown as CastRefEventStore;

    const results$ = store.timeline([
      { kinds: [CI_RESULT_KIND], "#a": repoCoords } as Filter,
    ]);
    const runMarkers$ = store.timeline([
      { kinds: [CI_RUN_KIND], "#a": repoCoords } as Filter,
    ]);
    const jobs$ = store.timeline([
      { kinds: [CI_JOB_RESULT_KIND], "#a": repoCoords } as Filter,
    ]);

    return combineLatest([
      results$,
      runMarkers$,
      jobs$,
      timer(0, EXPIRY_RECHECK_INTERVAL_MS),
    ]).pipe(
      map(([resultEvents, runEvents, jobEvents]) =>
        castAndGroupCIEvents(
          resultEvents as NostrEvent[],
          runEvents as NostrEvent[],
          jobEvents as NostrEvent[],
          castStore,
        ),
      ),
    );
  }, [coordsKey, store]);
}

/**
 * Cheap presence probe — does this repo have any CI events at all?
 *
 * Fires a one-shot limit-1 request for both kinds by #a (re-fired when the
 * relay group gains relays) and reads the store reactively, so events that
 * arrived via any other loader (#E comment ride-along, repo-wide 9841
 * markers, #c commit ticks) also flip it to true.
 *
 * Used by RepoLayout to decide whether to show the Actions tab.
 */
export function useRepoHasCI(
  repoCoords: string[] | undefined,
  repoRelayGroup: RelayGroup | undefined,
): boolean {
  const store = useEventStore();

  const coordsKey = repoCoords ? [...repoCoords].sort().join(",") : "";

  const relays =
    use$(() => relayGroupUrls$(repoRelayGroup), [repoRelayGroup]) ?? [];
  const relayKey = relays.join(",");

  // Presence probe — one event per relay is enough to decide.
  use$(() => {
    if (!repoCoords || repoCoords.length === 0 || relays.length === 0)
      return undefined;
    return resilientRequest(pool, relays, [
      {
        kinds: [...CI_EVENT_KINDS],
        "#a": repoCoords,
        limit: 1,
      } as Filter,
    ]).pipe(
      onlyEvents(),
      mapEventsToStore(store),
      catchError(() => EMPTY),
    );
  }, [coordsKey, relayKey, store]);

  const hasCI = use$(() => {
    if (!repoCoords || repoCoords.length === 0) return undefined;
    return store
      .timeline([{ kinds: [...CI_EVENT_KINDS], "#a": repoCoords } as Filter])
      .pipe(map((events) => events.length > 0));
  }, [coordsKey, store]);

  return hasCI ?? false;
}
