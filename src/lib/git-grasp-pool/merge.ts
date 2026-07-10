/**
 * git-grasp-pool — merge orchestration for Grasp repositories.
 *
 * One shared five-step sequence backs every browser merge flow (the code that
 * used to live in `MergePanel.handleMerge` / `handleApplyToTip` /
 * `handlePRMerge` and later in `src/lib/perform-merge.ts` +
 * `src/lib/perform-pr-merge.ts`):
 *
 *   1. Prepare the objects + new branch tip (strategy-specific, see below).
 *   2. Sign + publish the kind:30618 state to the Grasp relays ONLY
 *      (purgatory authorization).
 *   3. Push the packfile to the Grasp git server(s).
 *   4. Sign + publish the kind:1631 merged status event broadly, then
 *      auto-resolve issues referenced by commit-message keywords in the
 *      landed commits (ngit parity — see `@/lib/issue-auto-resolve`).
 *   5. Broadcast the kind:30618 state event to the remaining relays.
 *
 * If the push (step 3) fails, the state event expires from purgatory after
 * ~30 minutes — no rollback needed.
 *
 * Three strategies share the sequence, differing only in step 1:
 *
 *   - {@link performMerge} — patch-type items: build a merge commit (two
 *     parents: defaultBranchHead + patch tip) over the pre-built patch chain
 *     objects from `buildPatchChainObjects`.
 *   - {@link performPRMerge} — PR-type (kind:1618) items: the merge commit is
 *     pre-built by `usePRMergeability`; fetch the PR branch objects the
 *     target server may not have and include any three-way-merge outputs.
 *   - {@link performApplyToTip} — patch-type fallback: the linear replayed
 *     commits from `applyPatchChainToTip` are already built; the new tip is
 *     the last replayed commit (no merge commit).
 *
 * Pure computation + injected I/O — no React, no `@/services/nostr`. The
 * production `MergePanel` wires this up with the app's pool/outbox/EventStore;
 * the e2e harness injects local Grasp transports and exercises the exact same
 * sequence.
 */

import { nip19, type EventTemplate, type NostrEvent } from "nostr-tools";
import {
  createMergeCommitObject,
  assertFastForwardSafe,
} from "@/lib/patch-merge";
import type { PackableObject } from "@/lib/git-packfile";
import type { RefUpdate } from "@/lib/git-push";
import { RepoStateFactory } from "@/factories/RepoStateFactory";
import {
  StatusChangeFactory,
  STATUS_KIND_MAP,
} from "@/factories/StatusChangeFactory";
import type { CommitPerson } from "@/lib/git-objects";
import { getStateRefs } from "@/lib/nip34";
import {
  collectIssueResolutions,
  parseCommitsFromPackableObjects,
  signIssueResolutionStatus,
  type IssueCandidate,
} from "@/lib/issue-auto-resolve";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Progress steps reported via `onStep`. Mirrors MergePanel's MergeStep. */
export type PerformMergeStep =
  | "building"
  | "publishing-state"
  | "pushing"
  | "publishing-status"
  | "broadcasting-state"
  | "done";

/**
 * The minimal signer shape needed to sign factory events — satisfied by an
 * applesauce account signer and by the e2e `TestSigner`.
 */
export interface MergeSigner {
  getPublicKey(): string | Promise<string>;
  signEvent(template: EventTemplate): NostrEvent | Promise<NostrEvent>;
}

/** Identifies a patch event for the status `q` quote tags. */
export interface PatchEventRef {
  id: string;
  pubkey: string;
}

/**
 * Context for auto-resolving issues from commit-message keywords, mirroring
 * ngit's push-time behaviour (see `@/lib/issue-auto-resolve`). When supplied
 * (together with the `publishIssueStatus` transport), every commit landing on
 * the default branch — the PR/patch commits AND the merge commit itself — is
 * scanned for `closes/fixes/resolves/implements <issue-ref>` keywords and a
 * kind:1631 resolved status is published for each matching issue.
 */
export interface IssueAutoResolveContext {
  /** The repo's known issues (open/draft ones are eligible). */
  issues: IssueCandidate[];
  /** Confirmed repository maintainers (authorisation set). */
  maintainers: string[];
}

/** Repo / branch / item context shared by every merge strategy. */
export interface GraspMergeContext {
  /** Pubkey of the maintainer performing the merge (the signer). */
  signerPubkey: string;
  /** Signer used for the state + status events. */
  signer: MergeSigner;
  /** Repo d-tag identifier (must match the announcement). */
  dTag: string;
  /** Default branch name (e.g. "main"). */
  defaultBranchName: string;
  /** Current HEAD of the default branch (oldHash for the push). */
  defaultBranchHead: string;
  /** Current kind:30618 repository state, used to preserve all existing refs. */
  currentStateEvent?: NostrEvent | null;
  /** All repo coordinates ("30617:<pubkey>:<d>") for the status #a tags. */
  repoCoords: string[];
  /** The root PR/patch event id. */
  rootEventId: string;
  /** The PR/patch author pubkey. */
  rootAuthorPubkey: string;
  /**
   * When set, scan the commits landing on the default branch for issue
   * resolution keywords and publish kind:1631 statuses for matching issues
   * (requires the `publishIssueStatus` transport).
   */
  issueAutoResolve?: IssueAutoResolveContext;
}

/** Injected side-effecting transports, shared by every merge strategy. */
export interface GraspMergeTransports {
  /**
   * Publish the signed kind:30618 state event to the Grasp relays ONLY and
   * resolve once at least one accepted it (purgatory). Throw on total failure.
   */
  publishStateToGrasp: (state: NostrEvent) => Promise<void>;
  /**
   * Push the packfile (the supplied objects) updating the ref from
   * `oldHash` to `newHash`. Throw on failure.
   */
  pushObjects: (
    objects: PackableObject[],
    refUpdate: RefUpdate,
  ) => Promise<void>;
  /** Broadcast the signed kind:1631 status event to the wider relay set. */
  publishStatusBroadly: (status: NostrEvent) => Promise<void>;
  /**
   * Broadcast a signed kind:1631 issue-resolution status (produced by the
   * `issueAutoResolve` scan). Receives the matched issue so callers can
   * target the issue author's inbox relays. Required for issue
   * auto-resolution to run.
   */
  publishIssueStatus?: (
    status: NostrEvent,
    issue: IssueCandidate,
  ) => Promise<void>;
  /** Broadcast the signed kind:30618 state event to the remaining relays. */
  broadcastStateBroadly: (state: NostrEvent) => Promise<void>;
  /**
   * Called for every signed event the merge produces, in order
   * (state, then status). MergePanel uses this to add to the EventStore.
   */
  onEvent?: (event: NostrEvent) => void;
  /** Progress callback. */
  onStep?: (step: PerformMergeStep) => void;
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/**
 * Build the NIP-19 nevent for a PR/patch root event (used in the merge commit
 * message). Extracted so MergePanel and tests build it identically.
 */
export function buildPRNevent(
  rootEventId: string,
  rootAuthorPubkey: string,
  relays: string[],
): string {
  return nip19.neventEncode({
    id: rootEventId,
    author: rootAuthorPubkey,
    relays: relays.slice(0, 3),
  });
}

/**
 * Build a `CommitPerson` stamped with the current time and the local
 * timezone offset — the committer identity for browser-created commits.
 */
export function createCommitPersonNow(
  name: string,
  email: string,
): CommitPerson {
  const now = Math.floor(Date.now() / 1000);
  const tzOffset = new Date().getTimezoneOffset();
  const tzSign = tzOffset <= 0 ? "+" : "-";
  const tzHours = Math.floor(Math.abs(tzOffset) / 60)
    .toString()
    .padStart(2, "0");
  const tzMins = (Math.abs(tzOffset) % 60).toString().padStart(2, "0");
  return {
    name,
    email,
    timestamp: now,
    timezone: `${tzSign}${tzHours}${tzMins}`,
  };
}

/** Return a ref's commit hash from a kind:30618 state event, if declared. */
function getStateRefCommit(
  state: NostrEvent | null | undefined,
  refName: string,
): string | undefined {
  if (!state) return undefined;
  return getStateRefs(state).find((ref) => ref.name === refName)?.commitId;
}

/**
 * Sign the kind:1631 merged status event for a merged PR/patch. Also used on
 * its own by the "mark detected merge as merged" flow, which publishes the
 * missing status without pushing anything.
 */
export async function signMergedStatus(params: {
  signer: MergeSigner;
  signerPubkey: string;
  rootEventId: string;
  repoCoords: string[];
  rootAuthorPubkey: string;
  /** The merge commit (or new tip, for apply-to-tip) recorded in the tags. */
  mergeCommitHash: string;
  /** Patch chain events for the `q` quote tags. Empty/omitted for PR-type. */
  patchEventIds?: PatchEventRef[];
}): Promise<NostrEvent> {
  const patchQuoteTags = (params.patchEventIds ?? []).map(({ id, pubkey }) => [
    "q",
    id,
    "",
    pubkey,
  ]);

  return StatusChangeFactory.create(
    STATUS_KIND_MAP["resolved"],
    params.rootEventId,
    params.repoCoords,
    params.rootAuthorPubkey,
    params.signerPubkey,
  )
    .modifyPublicTags((tags) => [
      ...tags,
      ["merge-commit", params.mergeCommitHash],
      ["r", params.mergeCommitHash],
      ...patchQuoteTags,
    ])
    .sign(params.signer);
}

// ---------------------------------------------------------------------------
// Core sequence (steps 2–5)
// ---------------------------------------------------------------------------

interface MergeSequenceResult {
  /** The signed kind:30618 state event. */
  state: NostrEvent;
  /** The signed kind:1631 status event. */
  status: NostrEvent;
  /**
   * Signed kind:1631 statuses for issues auto-resolved from commit-message
   * keywords (empty when none matched or auto-resolution was not wired up).
   */
  issueStatuses: NostrEvent[];
}

/**
 * Scan the commits introduced by the kind:30618 default-branch ref update for
 * issue resolution keywords (ngit parity: revwalk `oldRef..newTip`), then
 * sign + publish one kind:1631 status per matched issue. This inspection is
 * scoped to the state event signed in step 2, not to whatever packfile objects
 * are pushed to bring lagging mirrors up to speed. Catch-up objects fetched by
 * `CatchUpObjectFetcher` in `grasp-push.ts` are added inside the pushObjects
 * transport and never enter this scan set — keep it that way. Failures here
 * never fail the merge — the push has already succeeded — so each issue is
 * attempted independently.
 */
async function publishIssueResolutions(
  params: GraspMergeContext & GraspMergeTransports,
  newTipHash: string,
  objects: PackableObject[],
  defaultBranchRef: string,
): Promise<NostrEvent[]> {
  const { issueAutoResolve, publishIssueStatus } = params;
  if (!issueAutoResolve || !publishIssueStatus) return [];

  const oldStateHead = getStateRefCommit(
    params.currentStateEvent,
    defaultBranchRef,
  );
  const stopAtHashes = new Set(
    [oldStateHead, params.defaultBranchHead].filter(
      (hash): hash is string => typeof hash === "string" && hash.length > 0,
    ),
  );

  const resolutions = collectIssueResolutions({
    commits: parseCommitsFromPackableObjects(objects),
    newTipHash,
    stopAtHashes,
    issues: issueAutoResolve.issues,
    signerPubkey: params.signerPubkey,
    maintainers: issueAutoResolve.maintainers,
  });

  const published: NostrEvent[] = [];
  for (const resolution of resolutions) {
    try {
      const status = await signIssueResolutionStatus({
        signer: params.signer,
        signerPubkey: params.signerPubkey,
        repoCoords: params.repoCoords,
        resolution,
      });
      await publishIssueStatus(status, resolution.issue);
      params.onEvent?.(status);
      published.push(status);
    } catch {
      // Best-effort: a failed issue status must not fail the merge.
    }
  }
  return published;
}

/**
 * Run the shared purgatory → push → status → broadcast sequence for a new
 * branch tip. Strategy-specific object preparation (step 1) happens in the
 * callers; this function is identical for all of them.
 */
async function runMergeSequence(
  params: GraspMergeContext & GraspMergeTransports,
  newTipHash: string,
  objects: PackableObject[],
  patchEventIds?: PatchEventRef[],
): Promise<MergeSequenceResult> {
  const defaultBranchRef = `refs/heads/${params.defaultBranchName}`;

  // Safety guard: the new tip MUST descend from the current branch tip (i.e.
  // advancing the branch to it is a fast-forward). A non-fast-forward update
  // orphans commits already on the branch — the disaster an incorrect merge
  // base can cause. Abort here, BEFORE any state event is published to
  // purgatory or any object is pushed.
  assertFastForwardSafe(objects, params.defaultBranchHead, newTipHash);

  // ── Step 2: Publish state to Grasp (purgatory) ──────────────────────────
  const state = await RepoStateFactory.updateBranch(
    params.dTag,
    params.currentStateEvent,
    newTipHash,
    params.defaultBranchName,
  ).sign(params.signer);

  params.onStep?.("publishing-state");
  await params.publishStateToGrasp(state);
  params.onEvent?.(state);

  // ── Step 3: Push packfile ───────────────────────────────────────────────
  params.onStep?.("pushing");
  await params.pushObjects(objects, {
    oldHash: params.defaultBranchHead,
    newHash: newTipHash,
    refName: defaultBranchRef,
  });

  // ── Step 4: Publish merged status ───────────────────────────────────────
  params.onStep?.("publishing-status");
  const status = await signMergedStatus({
    signer: params.signer,
    signerPubkey: params.signerPubkey,
    rootEventId: params.rootEventId,
    repoCoords: params.repoCoords,
    rootAuthorPubkey: params.rootAuthorPubkey,
    mergeCommitHash: newTipHash,
    patchEventIds,
  });

  await params.publishStatusBroadly(status);
  params.onEvent?.(status);

  // Issue auto-resolution from commit keywords (ngit parity). Runs after the
  // merged status so the primary status always lands first. The scan is tied
  // to the kind:30618 default-branch ref update signed above, not the full
  // pushed object set.
  const issueStatuses = await publishIssueResolutions(
    params,
    newTipHash,
    objects,
    defaultBranchRef,
  );

  // ── Step 5: Broadcast state to remaining relays ─────────────────────────
  params.onStep?.("broadcasting-state");
  await params.broadcastStateBroadly(state);

  params.onStep?.("done");

  return { state, status, issueStatuses };
}

// ---------------------------------------------------------------------------
// Patch-type merge (merge commit over the patch chain)
// ---------------------------------------------------------------------------

/** Inputs for {@link performMerge}. */
export interface PerformMergeParams
  extends GraspMergeContext, GraspMergeTransports {
  // --- Pre-built merge inputs (from buildPatchChainObjects) ---
  /** All chain objects (blobs + trees + commits) to pack alongside the merge commit. */
  chainObjects: PackableObject[];
  /** Tree hash of the final state after all patches applied. */
  finalTreeHash: string;
  /** Tip commit hash of the patch chain (second merge-commit parent). */
  tipCommitHash: string;

  // --- PR / patch metadata ---
  /** Effective (latest) PR/patch title used in the merge commit subject. */
  subject: string;
  /** NIP-19 nevent for the merge commit message's `nostr:` line. */
  prNevent: string;
  /**
   * Optional display name for the PR author (from kind-0 metadata) used in the
   * `PR-Author:` trailer. Omitted when no human-readable name is known.
   */
  rootAuthorName?: string;
  /**
   * Cover note body (kind:1624), when present. Recorded in the merge commit
   * message under a `CoverNote:` heading and takes precedence over
   * `prDescription`.
   */
  coverNote?: string;
  /**
   * PR description / patch body, recorded under a `PR description:` heading
   * when no cover note is present.
   */
  prDescription?: string;
  /** Committer identity for the merge commit. */
  committer: CommitPerson;
  /** Patch chain event ids (for the status `q` quote tags). */
  patchEventIds?: PatchEventRef[];
}

/** What {@link performMerge} resolves with on success. */
export interface PerformMergeResult extends MergeSequenceResult {
  /** The merge commit object that became the new branch tip. */
  mergeCommit: PackableObject;
}

/**
 * Merge a patch-type item: build the merge commit (two parents:
 * defaultBranchHead + patch tip) over the pre-built chain objects, then run
 * the shared sequence against the injected transports.
 */
export async function performMerge(
  params: PerformMergeParams,
): Promise<PerformMergeResult> {
  // ── Step 1: Build merge commit ──────────────────────────────────────────
  params.onStep?.("building");
  const mergeCommit = await createMergeCommitObject(
    params.finalTreeHash,
    params.defaultBranchHead,
    params.tipCommitHash,
    params.committer,
    {
      rootEventId: params.rootEventId,
      title: params.subject,
      nevent: params.prNevent,
      authorPubkey: params.rootAuthorPubkey,
      authorName: params.rootAuthorName,
      coverNote: params.coverNote,
      description: params.prDescription,
    },
  );

  const allObjects: PackableObject[] = [...params.chainObjects, mergeCommit];

  const { state, status, issueStatuses } = await runMergeSequence(
    params,
    mergeCommit.hash,
    allObjects,
    params.patchEventIds ?? [],
  );

  return { mergeCommit, state, status, issueStatuses };
}

// ---------------------------------------------------------------------------
// PR-type merge (kind:1618 — pre-built merge commit + branch objects)
// ---------------------------------------------------------------------------

/** Inputs for {@link performPRMerge}. */
export interface PerformPRMergeParams
  extends GraspMergeContext, GraspMergeTransports {
  // --- Pre-built PR merge inputs (from usePRMergeability) ---
  /** The pre-built merge commit object that becomes the new branch tip. */
  mergeCommitObj: PackableObject;
  /** Tip commit hash of the PR branch (second merge-commit parent). */
  prTipCommitHash: string;
  /** Computed merge base used by usePRMergeability. */
  mergeBase: string;
  /** New objects produced by the three-way merge, if any. */
  extraObjects: PackableObject[];

  // --- Injected git object source ---
  /**
   * Fetch the PR branch objects that the target Grasp server may not already
   * have. Returns null when the author's branch/clone URL is unavailable.
   */
  fetchBranchObjects: (
    tipCommitHash: string,
    stopAtCommitHash: string,
  ) => Promise<PackableObject[] | null>;
}

/** What {@link performPRMerge} resolves with on success. */
export interface PerformPRMergeResult extends PerformMergeResult {
  /** Full object set supplied to the push transport. */
  pushedObjects: PackableObject[];
}

/**
 * Merge a PR-type item: fetch the PR branch objects the target server may
 * lack (from the author's branch range), then run the shared sequence with
 * the pre-built merge commit as the new tip.
 */
export async function performPRMerge(
  params: PerformPRMergeParams,
): Promise<PerformPRMergeResult> {
  // ── Step 1: Fetch PR branch objects ───────────────────────────────────
  params.onStep?.("building");
  const branchObjects = await params.fetchBranchObjects(
    params.prTipCommitHash,
    params.mergeBase,
  );

  if (!branchObjects) {
    throw new Error(
      "Could not fetch the PR branch objects needed for the push. " +
        "The PR author's clone URL may be unavailable.",
    );
  }

  const allObjects: PackableObject[] = [
    params.mergeCommitObj,
    ...branchObjects,
    ...params.extraObjects,
  ];

  const { state, status, issueStatuses } = await runMergeSequence(
    params,
    params.mergeCommitObj.hash,
    allObjects,
  );

  return {
    mergeCommit: params.mergeCommitObj,
    state,
    status,
    issueStatuses,
    pushedObjects: allObjects,
  };
}

// ---------------------------------------------------------------------------
// Apply-to-tip (linear replay, no merge commit)
// ---------------------------------------------------------------------------

/** Inputs for {@link performApplyToTip}. */
export interface PerformApplyToTipParams
  extends GraspMergeContext, GraspMergeTransports {
  /** The replayed commit/tree/blob objects (from applyPatchChainToTip). */
  objects: PackableObject[];
  /** The last replayed commit — the new branch tip. */
  newTipCommitHash: string;
  /** Patch chain event ids (for the status `q` quote tags). */
  patchEventIds?: PatchEventRef[];
}

/** What {@link performApplyToTip} resolves with on success. */
export interface PerformApplyToTipResult extends MergeSequenceResult {
  /** The commit hash that became the new branch tip. */
  newTipCommitHash: string;
}

/**
 * Apply a patch chain directly on top of the current default branch HEAD
 * (like `git am`), producing linear commits with no merge commit. Used as a
 * fallback when the merge strategy fails (e.g. guessed base is wrong, or the
 * patch doesn't apply cleanly against the original base). The objects are
 * already built by `applyPatchChainToTip`; this just runs the shared
 * sequence.
 */
export async function performApplyToTip(
  params: PerformApplyToTipParams,
): Promise<PerformApplyToTipResult> {
  params.onStep?.("building");

  const { state, status, issueStatuses } = await runMergeSequence(
    params,
    params.newTipCommitHash,
    params.objects,
    params.patchEventIds ?? [],
  );

  return {
    state,
    status,
    issueStatuses,
    newTipCommitHash: params.newTipCommitHash,
  };
}
