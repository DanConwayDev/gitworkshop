/**
 * ngit-ci CI workflow events (experimental kinds 9841 / 9842 / 39842).
 *
 * Kind 9841 — "CI Job Result": one job's result, signed by the compute
 * provider. Content is a small log tail, with the full log in a `logs` tag.
 *
 * Kind 9842 — "CI Workflow Result": combined outcome of a workflow run,
 * signed by the coordinator and quoting each job result with `q` tags.
 *
 * Kind 39842 — "CI Workflow Progress": addressable, expiring progress marker
 * for queued/in-progress/recently-concluded runs.
 *
 * For PR-triggered workflows all three kinds carry NIP-22-style #E (PR root)
 * and #e (PR or PR Update trigger) tags, so CI activity for a PR is fetched
 * via #E alongside comments. For commit status ticks (CodeBar, commit history,
 * commit page) events are fetched by #c for the commits being displayed via
 * the batched ciResultsByCommitLoader singleton. The repo Actions tab fetches
 * all CI activity repo-wide by #a on demand (useRepoCI).
 *
 * Multi-maintainer repos are announced under one coordinate per maintainer,
 * so CI events may carry multiple `a` tags — one per coordinate. All #a
 * fetches and store reads pass the repo's full coordinate set
 * (repo.allCoordinates) so events tagged under any maintainer's coordinate
 * are found.
 *
 * Trust model: none yet — all CI events are displayed regardless of signer.
 * The signer identity is always shown next to results so users can judge for
 * themselves. A proper trust model (maintainer-designated coordinators/runners,
 * follows) can be layered on later if spam appears.
 *
 * See ngit-ci's NIP.md for the full event shapes.
 */

import type { CIRun } from "@/casts/CIRun";
import type { CIJobResultEvent } from "@/casts/CIJobResult";
import type { CIResult } from "@/casts/CIResult";

/** Kind 9841 — CI job result. */
export const CI_JOB_RESULT_KIND = 9841;

/** Kind 9842 — CI workflow result. */
export const CI_RESULT_KIND = 9842;

/** Kind 39842 — CI workflow progress (temporary addressable marker). */
export const CI_RUN_KIND = 39842;

/** All ngit-ci event kinds. */
export const CI_EVENT_KINDS = [
  CI_JOB_RESULT_KIND,
  CI_RESULT_KIND,
  CI_RUN_KIND,
] as const;

/** Conclusion values ngit-ci reports, aligned with GitHub's conclusion field. */
export type CIConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "startup_failure";

/** Status values a completed check can carry. */
export type CIResultStatus = CIConclusion;

/** A check's display status — a result status or a pending progress marker. */
export type CICheckStatus = CIResultStatus | "pending";

/** Normalize a raw `conclusion` tag value; unknown values are startup failures. */
export function normalizeCIConclusion(raw: string | undefined): CIResultStatus {
  switch (raw) {
    case "success":
    case "failure":
    case "neutral":
    case "cancelled":
    case "skipped":
    case "timed_out":
    case "startup_failure":
      return raw;
    default:
      return "startup_failure";
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
  /** The cast job result event carrying logs, duration, exit code, etc. */
  result: CIJobResultEvent;
}

/**
 * A workflow run attempt. A completed result is one immutable attempt; its
 * `q` tags are the authoritative association to its completed job results.
 */
export interface CIWorkflowRun {
  /** Stable attempt key, derived from the workflow, progress, or job event id. */
  key: string;
  /** The coordinator / runner identity that signed the workflow/progress. */
  pubkey: string;
  /** Commit the workflow ran against (`c` tag). */
  commitId: string | undefined;
  /** Selected workflow file path (`w` tag). */
  workflowPath: string | undefined;
  /** Normalized trigger name (`o` tag): push | pull_request | manual | schedule */
  trigger: string | undefined;
  /** Optional runner/provider name tag, when a publisher includes one. */
  runner: string | undefined;
  /** Optional platform tag, when a publisher includes one. */
  platform: string | undefined;
  /** Push trigger branch ref (`r` tag, e.g. refs/heads/main), when present. */
  branchRef: string | undefined;
  /** Root PR event id (`E` tag) for PR-triggered workflows, when present. */
  prRootId: string | undefined;
  /** Latest completed result per job id, sorted by job id. */
  jobs: CIJobResult[];
  /** True when this contains an unquoted job result without a workflow result. */
  isOrphanedJob: boolean;
  /** Latest combined workflow result, when the coordinator published one. */
  workflowResult: CIResult | undefined;
  /** Jobs currently executing according to the latest progress marker. */
  inProgressJobs: string[];
  /** An unexpired queued/in-progress kind:39842 marker newer than the result. */
  pendingRun: CIRun | undefined;
  /** Rolled-up status across workflow result, jobs, and progress marker. */
  status: CICheckStatus;
  /** Unix seconds of the most recent event in the group. */
  createdAt: number;
}

/**
 * Roll up multiple check statuses into one.
 * Precedence: startup_failure > timed_out > failure > pending > cancelled >
 * success > neutral > skipped.
 * Returns undefined for an empty list.
 */
export function rollupCIStatuses(
  statuses: CICheckStatus[],
): CICheckStatus | undefined {
  if (statuses.length === 0) return undefined;
  if (statuses.includes("startup_failure")) return "startup_failure";
  if (statuses.includes("timed_out")) return "timed_out";
  if (statuses.includes("failure")) return "failure";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("cancelled")) return "cancelled";
  if (statuses.includes("success")) return "success";
  if (statuses.includes("neutral")) return "neutral";
  return "skipped";
}

/**
 * Group CI casts into workflow runs.
 *
 * - Expired kind:39842 progress markers (NIP-40) are dropped.
 * - Every kind:9842 event is an independent completed workflow attempt, even
 *   when several attempts use the same commit and workflow path.
 * - A result only receives jobs that it explicitly quotes with `q` tags. An
 *   unquoted job is retained as an orphaned partial attempt rather than being
 *   incorrectly shown under an unrelated workflow result.
 * - Each kind:39842 `d` tag identifies one progress attempt; an event without
 *   a `d` tag remains a separate attempt.
 *
 * Returned runs are sorted most-recent-first.
 *
 * @param runs       - Cast kind:39842 events
 * @param results    - Cast kind:9842 events
 * @param jobResults - Cast kind:9841 events
 * @param nowSecs    - Current unix time in seconds (for expiration checks)
 */
export function groupCIWorkflowRuns(
  runs: CIRun[],
  results: CIResult[],
  jobResults: CIJobResultEvent[],
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
    latestPerJob: Map<string, CIJobResultEvent>;
    latestWorkflowResult: CIResult | undefined;
    pendingRun: CIRun | undefined;
    inProgressJobs: Set<string>;
    createdAt: number;
    isOrphanedJob: boolean;
  }

  const groups = new Map<string, Group>();

  const getGroup = (
    key: string,
    ev: CIRun | CIResult | CIJobResultEvent,
  ): Group => {
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
        latestWorkflowResult: undefined,
        pendingRun: undefined,
        inProgressJobs: new Set(),
        createdAt: 0,
        isOrphanedJob: false,
      };
      groups.set(key, group);
    }
    // Fill optional context from whichever event carries it.
    group.trigger ??= ev.trigger;
    group.runner ??= ev.runner;
    group.platform ??= ev.platform;
    group.branchRef ??= ev.branchRef;
    group.prRootId ??= ev.prRootId;
    group.createdAt = Math.max(group.createdAt, ev.event.created_at);
    return group;
  };

  // Nostr event ids are canonically lowercase hex, but accept uppercase ids
  // from non-conforming `q` tags so a quoted job is not also rendered as an
  // orphaned run.
  const eventIdKey = (id: string) => id.toLowerCase();
  const jobsById = new Map<string, CIJobResultEvent>();
  for (const job of jobResults) jobsById.set(eventIdKey(job.event.id), job);
  const referencedJobIds = new Set<string>();

  const addJobToGroup = (
    group: Group,
    job: CIJobResultEvent,
    jobId: string,
  ) => {
    const existing = group.latestPerJob.get(jobId);
    if (!existing || job.event.created_at > existing.event.created_at) {
      group.latestPerJob.set(jobId, job);
    }
  };

  for (const result of results) {
    const group = getGroup(`result:${result.event.id}`, result);
    group.latestWorkflowResult = result;
    for (const ref of result.jobRefs) {
      const eventId = eventIdKey(ref.eventId);
      referencedJobIds.add(eventId);
      const job = jobsById.get(eventId);
      if (job) addJobToGroup(group, job, ref.jobId ?? job.jobId);
    }
  }

  for (const run of runs) {
    if (run.expiration !== undefined && run.expiration <= nowSecs) continue;
    const key = run.runId
      ? `progress:${run.pubkey}:${run.runId}`
      : `progress:${run.event.id}`;
    const group = getGroup(key, run);
    if (
      !group.pendingRun ||
      run.event.created_at > group.pendingRun.event.created_at
    ) {
      group.pendingRun = run;
      group.inProgressJobs = new Set(run.inProgressJobs);
    }
    for (const ref of run.jobRefs) {
      const eventId = eventIdKey(ref.eventId);
      referencedJobIds.add(eventId);
      const job = jobsById.get(eventId);
      if (job) addJobToGroup(group, job, ref.jobId ?? job.jobId);
    }
  }

  for (const job of jobResults) {
    if (referencedJobIds.has(eventIdKey(job.event.id))) continue;
    const group = getGroup(`orphaned-job:${job.event.id}`, job);
    group.isOrphanedJob = true;
    addJobToGroup(group, job, job.jobId);
  }

  const out: CIWorkflowRun[] = [];
  for (const group of groups.values()) {
    const jobs: CIJobResult[] = [...group.latestPerJob.entries()]
      .map(([jobId, result]) => ({ jobId, status: result.status, result }))
      .sort((a, b) => a.jobId.localeCompare(b.jobId));

    // A queued/in-progress marker only counts as pending when newer than the
    // latest workflow result. Concluded progress markers are context only.
    const pendingRun =
      group.pendingRun &&
      group.pendingRun.isPending &&
      group.pendingRun.event.created_at >
        (group.latestWorkflowResult?.event.created_at ?? 0)
        ? group.pendingRun
        : undefined;

    const status = pendingRun
      ? "pending"
      : (group.latestWorkflowResult?.status ??
        group.pendingRun?.conclusion ??
        rollupCIStatuses(jobs.map((j) => j.status)));
    if (status === undefined) continue; // empty group (expired progress only)

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
      isOrphanedJob: group.isOrphanedJob,
      workflowResult: group.latestWorkflowResult,
      inProgressJobs: [...group.inProgressJobs].sort(),
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
      return "Failed";
    case "neutral":
      return "Neutral";
    case "cancelled":
      return "Cancelled";
    case "skipped":
      return "Skipped";
    case "timed_out":
      return "Timed out";
    case "startup_failure":
      return "Startup failed";
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
 * Short summary line for a set of runs, e.g. "2 successful, 1 failed".
 */
export function summarizeRuns(runs: CIWorkflowRun[]): string {
  const counts = new Map<CICheckStatus, number>();
  for (const run of runs) {
    counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
  }
  const order: CICheckStatus[] = [
    "startup_failure",
    "timed_out",
    "failure",
    "pending",
    "cancelled",
    "success",
    "neutral",
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
