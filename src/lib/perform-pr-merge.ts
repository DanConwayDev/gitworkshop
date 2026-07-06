/**
 * perform-pr-merge — merge orchestration for PR-type items (kind:1618).
 *
 * This mirrors `perform-merge.ts`, but PR-type items differ in two important
 * ways:
 *   1. `usePRMergeability` pre-builds the merge commit object while checking
 *      mergeability.
 *   2. The push must include the PR branch objects fetched from the author's
 *      branch range, plus any extra objects produced by a three-way merge.
 *
 * Production `MergePanel` wires this up with the app's pool/outbox/EventStore;
 * e2e tests can inject local Grasp transports and exercise the same sequence
 * without React or the `@/services/nostr` singleton graph.
 */

import type { NostrEvent } from "nostr-tools";
import type { PackableObject } from "@/lib/git-packfile";
import { assertFastForwardSafe } from "@/lib/patch-merge";
import { RepoStateFactory } from "@/factories/RepoStateFactory";
import {
  StatusChangeFactory,
  STATUS_KIND_MAP,
} from "@/factories/StatusChangeFactory";
import type { MergeSigner, PerformMergeStep } from "@/lib/perform-merge";

/** Inputs for {@link performPRMerge}. */
export interface PerformPRMergeParams {
  /** Pubkey of the maintainer performing the merge (the signer). */
  signerPubkey: string;
  /** Signer used for the state + status events. */
  signer: MergeSigner;

  // --- Pre-built PR merge inputs (from usePRMergeability) ---
  /** The pre-built merge commit object that becomes the new branch tip. */
  mergeCommitObj: PackableObject;
  /** Tip commit hash of the PR branch (second merge-commit parent). */
  prTipCommitHash: string;
  /** Computed merge base used by usePRMergeability. */
  mergeBase: string;
  /** New objects produced by the three-way merge, if any. */
  extraObjects: PackableObject[];

  // --- Repo / branch context ---
  /** Repo d-tag identifier (must match the announcement). */
  dTag: string;
  /** Default branch name (e.g. "main"). */
  defaultBranchName: string;
  /** Current HEAD of the default branch (oldHash). */
  defaultBranchHead: string;
  /** Current kind:30618 repository state, used to preserve all existing refs. */
  currentStateEvent?: NostrEvent | null;
  /** All repo coordinates ("30617:<pubkey>:<d>") for the status #a tags. */
  repoCoords: string[];

  // --- PR metadata ---
  /** The root PR event id. */
  rootEventId: string;
  /** The PR author pubkey. */
  rootAuthorPubkey: string;

  // --- Injected git object source ---
  /**
   * Fetch the PR branch objects that the target Grasp server may not already
   * have. Returns null when the author's branch/clone URL is unavailable.
   */
  fetchBranchObjects: (
    tipCommitHash: string,
    stopAtCommitHash: string,
  ) => Promise<PackableObject[] | null>;

  // --- Injected side-effects ---
  /**
   * Publish the signed kind:30618 state event to the Grasp relays ONLY and
   * resolve once at least one accepted it (purgatory). Throw on total failure.
   */
  publishStateToGrasp: (state: NostrEvent) => Promise<void>;
  /**
   * Push the packfile (the supplied objects) updating `defaultBranchName` from
   * `oldHash` to `newHash`. Throw on failure.
   */
  pushObjects: (
    objects: PackableObject[],
    refUpdate: { oldHash: string; newHash: string; refName: string },
  ) => Promise<void>;
  /** Broadcast the signed kind:1631 status event to the wider relay set. */
  publishStatusBroadly: (status: NostrEvent) => Promise<void>;
  /** Broadcast the signed kind:30618 state event to the wider relay set. */
  broadcastStateBroadly: (state: NostrEvent) => Promise<void>;
  /** Called for every signed event produced, in order (state, then status). */
  onEvent?: (event: NostrEvent) => void;
  /** Progress callback. */
  onStep?: (step: PerformMergeStep) => void;
}

/** What {@link performPRMerge} resolves with on success. */
export interface PerformPRMergeResult {
  /** The merge commit object that became the new branch tip. */
  mergeCommit: PackableObject;
  /** The signed kind:30618 state event. */
  state: NostrEvent;
  /** The signed kind:1631 status event. */
  status: NostrEvent;
  /** Full object set supplied to the push transport. */
  pushedObjects: PackableObject[];
}

/** Run the PR-type merge strategy end to end against injected transports. */
export async function performPRMerge(
  params: PerformPRMergeParams,
): Promise<PerformPRMergeResult> {
  const {
    signer,
    signerPubkey,
    mergeCommitObj,
    prTipCommitHash,
    mergeBase,
    extraObjects,
    dTag,
    defaultBranchName,
    defaultBranchHead,
    currentStateEvent,
    repoCoords,
    rootEventId,
    rootAuthorPubkey,
    fetchBranchObjects,
    publishStateToGrasp,
    pushObjects,
    publishStatusBroadly,
    broadcastStateBroadly,
    onEvent,
    onStep,
  } = params;

  const defaultBranchRef = `refs/heads/${defaultBranchName}`;

  // ── Step 1: Fetch PR branch objects + validate fast-forward safety ───────
  onStep?.("building");
  const branchObjects = await fetchBranchObjects(prTipCommitHash, mergeBase);

  if (!branchObjects) {
    throw new Error(
      "Could not fetch the PR branch objects needed for the push. " +
        "The PR author's clone URL may be unavailable.",
    );
  }

  const allObjects: PackableObject[] = [
    mergeCommitObj,
    ...branchObjects,
    ...extraObjects,
  ];

  // Abort before publishing the state event if the pre-built merge commit does
  // not descend from the current branch tip.
  assertFastForwardSafe(allObjects, defaultBranchHead, mergeCommitObj.hash);

  // ── Step 2: Publish state to Grasp (purgatory) ──────────────────────────
  const state = await RepoStateFactory.updateBranch(
    dTag,
    currentStateEvent,
    mergeCommitObj.hash,
    defaultBranchName,
  ).sign(signer);

  onStep?.("publishing-state");
  await publishStateToGrasp(state);
  onEvent?.(state);

  // ── Step 3: Push packfile ───────────────────────────────────────────────
  onStep?.("pushing");
  await pushObjects(allObjects, {
    oldHash: defaultBranchHead,
    newHash: mergeCommitObj.hash,
    refName: defaultBranchRef,
  });

  // ── Step 4: Publish merged status ───────────────────────────────────────
  onStep?.("publishing-status");
  const statusKind = STATUS_KIND_MAP["resolved"];
  const status = await StatusChangeFactory.create(
    statusKind,
    rootEventId,
    repoCoords,
    rootAuthorPubkey,
    signerPubkey,
  )
    .modifyPublicTags((tags) => [
      ...tags,
      ["merge-commit", mergeCommitObj.hash],
      ["r", mergeCommitObj.hash],
    ])
    .sign(signer);

  await publishStatusBroadly(status);
  onEvent?.(status);

  // ── Step 5: Broadcast state to remaining relays ─────────────────────────
  onStep?.("broadcasting-state");
  await broadcastStateBroadly(state);

  onStep?.("done");

  return {
    mergeCommit: mergeCommitObj,
    state,
    status,
    pushedObjects: allObjects,
  };
}
