/**
 * ngit-ci CI workflow events (experimental kinds 9841 / 9842).
 *
 * Kind 9841 — "CI Workflow Started": optional, temporary running indicator
 * with a NIP-40 expiration. Fetched repo-wide via the #a coordinate filter
 * (they expire, so the set stays small).
 *
 * Kind 9842 — "CI Workflow Result": independent attestation of a workflow /
 * job outcome, signed by the runner/coordinator identity. For PR-triggered
 * workflows both kinds carry NIP-22-style #E (PR root) and #e (PR or PR
 * Update trigger) tags, so results for a PR are fetched via #E alongside
 * comments. For commit status ticks (CodeBar, commit history, commit page)
 * results are fetched by #c for the commits being displayed via the batched
 * ciResultsByCommitLoader singleton. The repo Actions tab fetches all
 * results repo-wide by #a on demand (useRepoCI).
 *
 * Multi-maintainer repos are announced under one coordinate per maintainer,
 * so CI events may carry multiple `a` tags — one per coordinate. All #a
 * fetches and store reads pass the repo's full coordinate set
 * (repo.allCoordinates) so events tagged under any maintainer's coordinate
 * are found.
 *
 * Trust model: none yet — all CI events are displayed regardless of signer.
 * The runner identity is always shown next to results so users can judge for
 * themselves. A proper trust model (maintainer-designated runners, follows)
 * can be layered on later if spam appears.
 *
 * See ngit-ci's NIP.md for the full event shapes.
 */

import type { CIRun } from "@/casts/CIRun";
import type { CIResult } from "@/casts/CIResult";

/** Kind 9841 — CI workflow started (temporary running indicator). */
export const CI_RUN_KIND = 9841;

/** Kind 9842 — CI workflow result. */
export const CI_RESULT_KIND = 9842;

/** Status values a kind:9842 result can carry. */
export type CIResultStatus = "success" | "failure" | "error" | "skipped";

/** A check's display status — a result status or a pending running marker. */
export type CICheckStatus = CIResultStatus | "pending";

/** Normalize a raw `status` tag value; unknown values are treated as error. */
export function normalizeCIStatus(raw: string | undefined): CIResultStatus {
  switch (raw) {
    case "success":
    case "failure":
    case "error":
    case "skipped":
      return raw;
    default:
      return "error";
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** The latest result for one job within a workflow run group. */
export interface CIJobResult {
  /** Job identity from the `job` tag (falls back to the workflow path). */
  jobId: string;
  status: CIResultStatus;
  /** The cast result event carrying logs, duration, exit code, etc. */
  result: CIResult;
}

/**
 * A workflow run group — all CI events sharing the same
 * (runner pubkey, commit, workflow path).
 */
export interface CIWorkflowRun {
  /** Stable grouping key: `${pubkey}|${commitId}|${workflowPath}` */
  key: string;
  /** The runner / coordinator identity that signed the events. */
  pubkey: string;
  /** Commit the workflow ran against (`c` tag). */
  commitId: string | undefined;
  /** Selected workflow file path (`w` tag). */
  workflowPath: string | undefined;
  /** Normalized trigger name (`x` tag): push | pull_request | manual | schedule */
  trigger: string | undefined;
  /** Optional runner name tag. */
  runner: string | undefined;
  /** Optional platform tag (github-actions | forgejo-actions | gitlab-ci). */
  platform: string | undefined;
  /** Push trigger branch ref (`r` tag, e.g. refs/heads/main), when present. */
  branchRef: string | undefined;
  /** Root PR event id (`E` tag) for PR-triggered workflows, when present. */
  prRootId: string | undefined;
  /** Latest result per job id, sorted by job id. */
  jobs: CIJobResult[];
  /**
   * An unexpired kind:9841 running marker newer than every result in the
   * group — the workflow is (re-)running right now.
   */
  pendingRun: CIRun | undefined;
  /** Rolled-up status across jobs + pending marker. */
  status: CICheckStatus;
  /** Unix seconds of the most recent event in the group. */
  createdAt: number;
}

/**
 * Roll up multiple check statuses into one.
 * Precedence: error > failure > pending > success > skipped.
 * Returns undefined for an empty list.
 */
export function rollupCIStatuses(
  statuses: CICheckStatus[],
): CICheckStatus | undefined {
  if (statuses.length === 0) return undefined;
  if (statuses.includes("error")) return "error";
  if (statuses.includes("failure")) return "failure";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("success")) return "success";
  return "skipped";
}

function groupKey(
  pubkey: string,
  commitId: string | undefined,
  workflowPath: string | undefined,
): string {
  return `${pubkey}|${commitId ?? ""}|${workflowPath ?? ""}`;
}

/**
 * Group CI casts into workflow runs.
 *
 * - Expired kind:9841 markers (NIP-40) are dropped.
 * - Within a group, only the latest kind:9842 per job id is kept.
 * - A 9841 marker counts as pending only when it is newer than every result
 *   in its group (a re-run after previous results shows as pending again).
 *
 * Returned runs are sorted most-recent-first.
 *
 * @param runs    - Cast kind:9841 events
 * @param results - Cast kind:9842 events
 * @param nowSecs - Current unix time in seconds (for expiration checks)
 */
export function groupCIWorkflowRuns(
  runs: CIRun[],
  results: CIResult[],
  nowSecs: number = Math.floor(Date.now() / 1000),
): CIWorkflowRun[] {
  interface Group {
    key: string;
    pubkey: string;
    commitId: string | undefined;
    workflowPath: string | undefined;
    trigger: string | undefined;
    runner: string | undefined;
    platform: string | undefined;
    branchRef: string | undefined;
    prRootId: string | undefined;
    latestPerJob: Map<string, CIResult>;
    latestResultAt: number;
    pendingRun: CIRun | undefined;
    createdAt: number;
  }

  const groups = new Map<string, Group>();

  const getGroup = (ev: CIRun | CIResult): Group => {
    const key = groupKey(ev.pubkey, ev.commitId, ev.workflowPath);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        pubkey: ev.pubkey,
        commitId: ev.commitId,
        workflowPath: ev.workflowPath,
        trigger: ev.trigger,
        runner: ev.runner,
        platform: ev.platform,
        branchRef: ev.branchRef,
        prRootId: ev.prRootId,
        latestPerJob: new Map(),
        latestResultAt: 0,
        pendingRun: undefined,
        createdAt: 0,
      };
      groups.set(key, group);
    }
    // Fill optional context from whichever event carries it
    group.trigger ??= ev.trigger;
    group.runner ??= ev.runner;
    group.platform ??= ev.platform;
    group.branchRef ??= ev.branchRef;
    group.prRootId ??= ev.prRootId;
    group.createdAt = Math.max(group.createdAt, ev.event.created_at);
    return group;
  };

  for (const result of results) {
    const group = getGroup(result);
    const jobId = result.jobId;
    const existing = group.latestPerJob.get(jobId);
    if (!existing || result.event.created_at > existing.event.created_at) {
      group.latestPerJob.set(jobId, result);
    }
    group.latestResultAt = Math.max(
      group.latestResultAt,
      result.event.created_at,
    );
  }

  for (const run of runs) {
    if (run.expiration !== undefined && run.expiration <= nowSecs) continue;
    const group = getGroup(run);
    if (
      !group.pendingRun ||
      run.event.created_at > group.pendingRun.event.created_at
    ) {
      group.pendingRun = run;
    }
  }

  const out: CIWorkflowRun[] = [];
  for (const group of groups.values()) {
    const jobs: CIJobResult[] = [...group.latestPerJob.entries()]
      .map(([jobId, result]) => ({ jobId, status: result.status, result }))
      .sort((a, b) => a.jobId.localeCompare(b.jobId));

    // A running marker only counts as pending when newer than every result.
    const pendingRun =
      group.pendingRun &&
      group.pendingRun.event.created_at > group.latestResultAt
        ? group.pendingRun
        : undefined;

    const statuses: CICheckStatus[] = jobs.map((j) => j.status);
    if (pendingRun) statuses.push("pending");
    const status = rollupCIStatuses(statuses);
    if (status === undefined) continue; // empty group (expired run only)

    out.push({
      key: group.key,
      pubkey: group.pubkey,
      commitId: group.commitId,
      workflowPath: group.workflowPath,
      trigger: group.trigger,
      runner: group.runner,
      platform: group.platform,
      branchRef: group.branchRef,
      prRootId: group.prRootId,
      jobs,
      pendingRun,
      status,
      createdAt: group.createdAt,
    });
  }

  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Split workflow runs into "current" and "older" relative to a tip commit.
 *
 * When `tipCommitId` is known, current = runs for that commit. When it isn't,
 * falls back to the commit with the most recent CI activity so lists can
 * still show a meaningful badge.
 */
export function splitRunsByCommit(
  runs: CIWorkflowRun[],
  tipCommitId: string | undefined,
): { current: CIWorkflowRun[]; older: CIWorkflowRun[] } {
  if (runs.length === 0) return { current: [], older: [] };

  const targetCommit =
    tipCommitId ?? runs.find((r) => r.commitId !== undefined)?.commitId;

  if (!targetCommit) {
    // No commit context at all — treat everything as current.
    return { current: runs, older: [] };
  }

  const current: CIWorkflowRun[] = [];
  const older: CIWorkflowRun[] = [];
  for (const run of runs) {
    if (run.commitId === targetCommit) current.push(run);
    else older.push(run);
  }
  return { current, older };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Human-readable label for a check status. */
export function ciStatusLabel(status: CICheckStatus): string {
  switch (status) {
    case "success":
      return "Successful";
    case "failure":
      return "Failing";
    case "error":
      return "Errored";
    case "skipped":
      return "Skipped";
    case "pending":
      return "In progress";
  }
}

/** Format a duration in seconds as "42s" / "2m 5s" / "1h 3m". */
export function formatCIDuration(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return null;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * Short summary line for a set of runs, e.g. "2 successful, 1 failing".
 */
export function summarizeRuns(runs: CIWorkflowRun[]): string {
  const counts = new Map<CICheckStatus, number>();
  for (const run of runs) {
    counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
  }
  const order: CICheckStatus[] = [
    "error",
    "failure",
    "pending",
    "success",
    "skipped",
  ];
  const parts: string[] = [];
  for (const status of order) {
    const n = counts.get(status);
    if (!n) continue;
    parts.push(`${n} ${ciStatusLabel(status).toLowerCase()}`);
  }
  return parts.join(", ");
}
