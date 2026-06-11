/**
 * perform-merge — the merge orchestration for patch-type PRs, extracted from
 * `MergePanel.handleMerge` so it can run without React or the
 * `@/services/nostr` singleton graph.
 *
 * `MergePanel` wires this up with the production pool / outboxStore / eventStore;
 * the e2e harness wires it up against a single local grasp relay. The pure git
 * + Nostr work (building the merge commit, the packfile, and the kind:30618 /
 * kind:1631 events) lives here; the side-effecting transport (which relays to
 * publish to, how to push) is injected so the same code path is exercised in
 * both environments.
 *
 * Sequence (identical to the original `handleMerge`):
 *   1. Build merge commit object (two parents: defaultBranchHead + patch tip).
 *   2. Sign + publish kind:30618 state to the Grasp relays ONLY (purgatory).
 *   3. Push the packfile (chain objects + merge commit) to the Grasp git server.
 *   4. Sign + publish the kind:1631 merged status event broadly.
 *   5. Broadcast the kind:30618 state event to the remaining relays.
 *
 * If the push (step 3) fails, the state event expires from purgatory after
 * ~30 minutes — no rollback needed.
 */

import { nip19, type EventTemplate, type NostrEvent } from "nostr-tools";
import { createMergeCommitObject } from "@/lib/patch-merge";
import type { PackableObject } from "@/lib/git-packfile";
import { RepoStateFactory } from "@/factories/RepoStateFactory";
import {
  StatusChangeFactory,
  STATUS_KIND_MAP,
} from "@/factories/StatusChangeFactory";
import type { CommitPerson } from "@/lib/git-objects";

/** Progress steps reported via `onStep`. Mirror MergePanel's MergeStep. */
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

/** Inputs for {@link performMerge}. */
export interface PerformMergeParams {
  /** Pubkey of the maintainer performing the merge (the signer). */
  signerPubkey: string;
  /** Signer used for the state + status events. */
  signer: MergeSigner;

  // --- Pre-built merge inputs (from buildPatchChainObjects) ---
  /** All chain objects (blobs + trees + commits) to pack alongside the merge commit. */
  chainObjects: PackableObject[];
  /** Tree hash of the final state after all patches applied. */
  finalTreeHash: string;
  /** Tip commit hash of the patch chain (second merge-commit parent). */
  tipCommitHash: string;

  // --- Repo / branch context ---
  /** Repo d-tag identifier (must match the announcement). */
  dTag: string;
  /** Default branch name (e.g. "main"). */
  defaultBranchName: string;
  /** Current HEAD of the default branch (first merge-commit parent / oldHash). */
  defaultBranchHead: string;
  /** All repo coordinates ("30617:<pubkey>:<d>") for the status #a tags. */
  repoCoords: string[];

  // --- PR / patch metadata ---
  /** The root PR/patch event id. */
  rootEventId: string;
  /** The PR/patch author pubkey. */
  rootAuthorPubkey: string;
  /** Subject used in the merge commit message. */
  subject: string;
  /** "patch" or "pr" — affects the merge commit message wording. */
  itemType: "patch" | "pr";
  /** NIP-19 nevent for the merge commit message's `Nostr-PR:` trailer. */
  prNevent: string;
  /** Optional cover-note / body text included in the merge commit message. */
  prDescription?: string;
  /** Committer identity for the merge commit. */
  committer: CommitPerson;
  /** Patch chain event ids (for the status `q` quote tags). Empty for PR-type. */
  patchEventIds?: { id: string; pubkey: string }[];

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
  /**
   * Called for every signed event the merge produces, in order
   * (state, then status). MergePanel uses this to add to the EventStore.
   */
  onEvent?: (event: NostrEvent) => void;
  /** Progress callback. */
  onStep?: (step: PerformMergeStep) => void;
}

/** What {@link performMerge} resolves with on success. */
export interface PerformMergeResult {
  /** The merge commit object that became the new branch tip. */
  mergeCommit: PackableObject;
  /** The signed kind:30618 state event. */
  state: NostrEvent;
  /** The signed kind:1631 status event. */
  status: NostrEvent;
}

/**
 * Run the merge strategy end to end against injected transports.
 *
 * Pure computation + injected I/O — no React, no `@/services/nostr`.
 */
export async function performMerge(
  params: PerformMergeParams,
): Promise<PerformMergeResult> {
  const {
    signer,
    signerPubkey,
    chainObjects,
    finalTreeHash,
    tipCommitHash,
    dTag,
    defaultBranchName,
    defaultBranchHead,
    repoCoords,
    rootEventId,
    rootAuthorPubkey,
    subject,
    itemType,
    prNevent,
    prDescription,
    committer,
    patchEventIds = [],
    publishStateToGrasp,
    pushObjects,
    publishStatusBroadly,
    broadcastStateBroadly,
    onEvent,
    onStep,
  } = params;

  const defaultBranchRef = `refs/heads/${defaultBranchName}`;

  // ── Step 1: Build merge commit ──────────────────────────────────────────
  onStep?.("building");
  const mergeCommit = await createMergeCommitObject(
    finalTreeHash,
    defaultBranchHead,
    tipCommitHash,
    committer,
    subject,
    itemType,
    prNevent,
    prDescription,
  );

  const allObjects: PackableObject[] = [...chainObjects, mergeCommit];

  // ── Step 2: Publish state to Grasp (purgatory) ──────────────────────────
  const state = await RepoStateFactory.create(
    dTag,
    mergeCommit.hash,
    defaultBranchName,
  ).sign(signer);

  onStep?.("publishing-state");
  await publishStateToGrasp(state);
  onEvent?.(state);

  // ── Step 3: Push packfile ───────────────────────────────────────────────
  onStep?.("pushing");
  await pushObjects(allObjects, {
    oldHash: defaultBranchHead,
    newHash: mergeCommit.hash,
    refName: defaultBranchRef,
  });

  // ── Step 4: Publish merged status ───────────────────────────────────────
  onStep?.("publishing-status");
  const statusKind = STATUS_KIND_MAP["resolved"];
  const patchQuoteTags = patchEventIds.map(({ id, pubkey }) => [
    "q",
    id,
    "",
    pubkey,
  ]);

  const status = await StatusChangeFactory.create(
    statusKind,
    rootEventId,
    repoCoords,
    rootAuthorPubkey,
    signerPubkey,
  )
    .modifyPublicTags((tags) => [
      ...tags,
      ["merge-commit", mergeCommit.hash],
      ["r", mergeCommit.hash],
      ...patchQuoteTags,
    ])
    .sign(signer);

  await publishStatusBroadly(status);
  onEvent?.(status);

  // ── Step 5: Broadcast state to remaining relays ─────────────────────────
  onStep?.("broadcasting-state");
  await broadcastStateBroadly(state);

  onStep?.("done");

  return { mergeCommit, state, status };
}

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
