/**
 * Merge button e2e test.
 *
 * Exercises the REAL merge pipeline end to end against a live ngit-grasp
 * server — the same production functions the Merge button runs, with no mocks
 * of the git or relay layers:
 *
 *   1. seedRepo()       — announce → state → push an initial commit.
 *   2. seedPatchPR()    — a contributor builds a 2nd commit + publishes a
 *                         kind:1617 patch event to the grasp relay.
 *   3. buildPatchChainObjects() — re-derive the patch's git objects against the
 *                         base tree fetched from the grasp git server.
 *   4. performMerge()   — build the merge commit, publish kind:30618 state to
 *                         grasp (purgatory), push the packfile, publish the
 *                         kind:1631 merged status, broadcast the state.
 *
 * Assertions:
 *   - The patch's claimed commit hash verifies (`allHashesVerified`).
 *   - The merge commit becomes the branch tip on the git server
 *     (`getReceivePackRefs`).
 *   - The kind:30618 state and kind:1631 status are queryable from the relay
 *     and point at the new merge commit.
 *
 * `performMerge` is the plain-module extraction of `MergePanel.handleMerge`
 * (see `src/lib/perform-merge.ts`); the React component now calls the same
 * function, so this test covers the production path. Transport is injected so
 * we publish ONLY to the local grasp relay (via `RelayClient`) and push ONLY to
 * the local grasp git server — never `@/services/nostr`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { finalizeEvent, type NostrEvent } from "nostr-tools";
import { EventStore } from "applesauce-core";
import {
  GraspServer,
  RelayClient,
  TestSigner,
  seedRepo,
  seedPatchPR,
  graspBinaryAvailable,
  REPO_STATE_KIND,
  type SeededRepo,
} from "./harness";
import { Patch } from "@/casts/Patch";
import { PR } from "@/casts/PR";
import {
  createMergeCommitObject,
  buildPatchChainObjects,
  type PatchChainBuildResult,
} from "@/lib/patch-merge";
import { performMerge, buildPRNevent } from "@/lib/perform-merge";
import { performPRMerge } from "@/lib/perform-pr-merge";
import { GitGraspPool } from "@/lib/git-grasp-pool";
import {
  createPackfile,
  packBlob,
  packCommit,
  packTree,
} from "@/lib/git-packfile";
import {
  pushToGitServer,
  getReceivePackRefs,
  ZERO_HASH,
  type RefUpdate,
} from "@/lib/git-push";
import type { PackableObject } from "@/lib/git-packfile";
import type { CommitPerson, TreeEntry } from "@/lib/git-objects";
import { PR_KIND, STATUS_RESOLVED } from "@/lib/nip34";

const describeIfGrasp = graspBinaryAvailable() ? describe : describe.skip;

// Runs whenever the ngit-grasp binary is available (NGIT_GRASP_BIN or a sibling
// clone); skips cleanly otherwise. The earlier GitGraspPool fetch blocker
// (`indexedDB is not defined` in node — see e2e/HANDOFF.md) is fixed in
// src/lib/git-grasp-pool/cache.ts, so the full merge path runs end-to-end here.
const describeMerge = describeIfGrasp;

interface SeededKindPR {
  pr: NostrEvent;
  commit: string;
  state: NostrEvent;
  branch: string;
}

async function waitUntilAfterUnixSecond(timestamp: number): Promise<void> {
  while (Math.floor(Date.now() / 1000) <= timestamp) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function seedKindPR(
  repo: SeededRepo,
  relay: RelayClient,
  maintainer: TestSigner,
  contributor: TestSigner,
  options: {
    branch: string;
    path: string;
    content: string;
    subject: string;
    body?: string;
  },
): Promise<SeededKindPR> {
  const timestamp = repo.headCommitTimestamp + 60;
  const person: CommitPerson = {
    name: "e2e PR contributor",
    email: `${contributor.npub}@nostr`,
    timestamp,
    timezone: "+0000",
  };

  const blob = await packBlob(new TextEncoder().encode(options.content));
  const baseEntries: TreeEntry[] = Object.entries(repo.blobHashes).map(
    ([name, hash]) => ({ mode: "100644", name, hash }),
  );
  const treeEntries: TreeEntry[] = [
    ...baseEntries.filter((entry) => entry.name !== options.path),
    { mode: "100644", name: options.path, hash: blob.hash },
  ];
  const tree = await packTree(treeEntries);
  const commit = await packCommit({
    treeHash: tree.hash,
    parentHashes: [repo.headCommit],
    author: person,
    committer: person,
    message: options.body
      ? `${options.subject}\n\n${options.body}`
      : options.subject,
  });

  const prBranchRef = `refs/heads/${options.branch}`;
  const state = finalizeEvent(
    {
      kind: REPO_STATE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [
        ["d", repo.identifier],
        [`refs/heads/${repo.branch}`, repo.headCommit],
        [prBranchRef, commit.hash],
        ["HEAD", `ref: refs/heads/${repo.branch}`],
      ],
    },
    maintainer.secretKey,
  );
  await relay.publish(state);

  const packfile = await createPackfile([blob, tree, commit]);
  const pushResult = await pushToGitServer(
    repo.cloneUrl,
    [
      {
        oldHash: ZERO_HASH,
        newHash: commit.hash,
        refName: prBranchRef,
      },
    ],
    packfile,
  );
  if (!pushResult.unpackOk || !pushResult.refResults.every((r) => r.ok)) {
    throw new Error(
      `seedKindPR: branch push failed (unpackOk=${pushResult.unpackOk}): ` +
        pushResult.refResults
          .map((r) => `${r.refName}=${r.ok ? "ok" : r.reason}`)
          .join(", "),
    );
  }

  // The merge will publish a replacement kind:30618. Tick past this state's
  // second so the merged state wins deterministically on relays with same-second
  // replaceable tie behaviour.
  await waitUntilAfterUnixSecond(state.created_at);

  const pr = finalizeEvent(
    {
      kind: PR_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: options.body ?? "",
      tags: [
        ["a", repo.coordinate],
        ["subject", options.subject],
        ["c", commit.hash],
        ["merge-base", repo.headCommit],
        ["clone", repo.cloneUrl],
        ["p", repo.pubkey],
        ["alt", `git pull request: ${options.subject}`],
      ],
    },
    contributor.secretKey,
  );
  await relay.publish(pr);

  return { pr, commit: commit.hash, state, branch: options.branch };
}

describeMerge("e2e — Merge button (merge strategy)", () => {
  let server: GraspServer;
  let relay: RelayClient;
  let maintainer: TestSigner;
  let contributor: TestSigner;
  let repo: SeededRepo;
  let pool: GitGraspPool;

  beforeAll(async () => {
    server = await GraspServer.start({ role: "merge" });
    relay = await RelayClient.connect(server.relayUrl);
    maintainer = new TestSigner();
    contributor = new TestSigner();

    repo = await seedRepo(server, relay, maintainer, {
      identifier: "merge-repo",
      name: "Merge Repo",
      files: { "README.md": "# merge repo\n\nline one\nline two\n" },
    });

    // A pool pointed at the local grasp clone URL. CORS proxy disabled — the
    // grasp server serves CORS headers natively and we're in node anyway.
    pool = new GitGraspPool({
      cloneUrls: [repo.cloneUrl],
      corsProxyBase: null,
    });
  });

  afterAll(async () => {
    pool?.dispose();
    relay?.close();
    await server?.stop();
  });

  it("seeds a patch PR whose claimed commit hash verifies, then merges it to the branch tip", async () => {
    // ── 1. Contributor publishes a kind:1617 patch (new file) ────────────
    const seeded = await seedPatchPR(repo, relay, contributor, {
      path: "FEATURE.md",
      content: "# Feature\n\na brand new feature file\n",
      subject: "Add FEATURE.md",
    });

    // The patch event is queryable from the relay.
    const patches = await relay.query([
      { kinds: [1617], authors: [contributor.pubkey] },
    ]);
    expect(patches.map((e) => e.id)).toContain(seeded.patch.id);

    // ── 2. Re-derive the patch chain objects against the base tree ───────
    const store = new EventStore();
    const patchCast = new Patch(seeded.patch, store);
    expect(patchCast.commitId).toBe(seeded.commit);
    expect(patchCast.parentCommitId).toBe(repo.headCommit);

    const abort = new AbortController();
    const buildOutcome = await buildPatchChainObjects(
      [patchCast],
      pool,
      abort.signal,
      [repo.cloneUrl],
    );

    if ("reason" in buildOutcome) {
      throw new Error(`buildPatchChainObjects failed: ${buildOutcome.reason}`);
    }
    const buildResult: PatchChainBuildResult = buildOutcome;

    // The merge code re-derived the contributor's commit hash exactly.
    expect(buildResult.tipCommitHash).toBe(seeded.commit);
    expect(buildResult.allHashesVerified).toBe(true);

    // ── 3. Run the production merge orchestration ────────────────────────
    const committer: CommitPerson = {
      name: "maintainer",
      email: `${maintainer.npub}@nostr`,
      timestamp: repo.headCommitTimestamp + 120,
      timezone: "+0000",
    };

    const collectedEvents: NostrEvent[] = [];

    const result = await performMerge({
      signer: maintainer,
      signerPubkey: maintainer.pubkey,
      chainObjects: buildResult.objects,
      finalTreeHash: buildResult.finalTreeHash,
      tipCommitHash: buildResult.tipCommitHash,
      dTag: repo.identifier,
      defaultBranchName: repo.branch,
      defaultBranchHead: repo.headCommit,
      repoCoords: [repo.coordinate],
      rootEventId: seeded.patch.id,
      rootAuthorPubkey: contributor.pubkey,
      subject: patchCast.subject,
      prNevent: "nevent1test",
      committer,
      patchEventIds: [{ id: seeded.patch.id, pubkey: contributor.pubkey }],
      // Publish state to the grasp relay ONLY (purgatory authorization).
      publishStateToGrasp: async (state) => {
        await relay.publish(state);
      },
      // Push the packfile to the grasp git server.
      pushObjects: async (objects: PackableObject[], refUpdate: RefUpdate) => {
        const packfile = await createPackfile(objects);
        const pushResult = await pushToGitServer(
          repo.cloneUrl,
          [refUpdate],
          packfile,
        );
        if (!pushResult.unpackOk || !pushResult.refResults.every((r) => r.ok)) {
          throw new Error(
            `push failed (unpackOk=${pushResult.unpackOk}): ` +
              pushResult.refResults
                .map((r) => `${r.refName}=${r.ok ? "ok" : r.reason}`)
                .join(", "),
          );
        }
      },
      // "Broadcast" steps go to the same single relay in the test.
      publishStatusBroadly: async (status) => {
        await relay.publish(status);
      },
      broadcastStateBroadly: async () => {
        // already published to the only relay we have; no-op
      },
      onEvent: (e) => collectedEvents.push(e),
    });

    // ── 4. Assert: merge commit is the new tip on the git server ─────────
    const refs = await getReceivePackRefs(repo.cloneUrl);
    expect(refs.refs[`refs/heads/${repo.branch}`]).toBe(
      result.mergeCommit.hash,
    );
    // The merge commit must differ from both parents.
    expect(result.mergeCommit.hash).not.toBe(repo.headCommit);
    expect(result.mergeCommit.hash).not.toBe(seeded.commit);

    // ── 5. Assert: the kind:30618 state on the relay points at the merge ──
    // The state event is accepted into purgatory first and only promoted to
    // the queryable relay DB after the push materialises the refs — that
    // promotion is asynchronous, so poll briefly instead of asserting on the
    // first query. The relay may also still return the seed state alongside
    // the merged state and makes no ordering guarantee, so assert against the
    // exact state event performMerge published.
    let mergedState: NostrEvent | undefined;
    for (let attempt = 0; attempt < 20 && !mergedState; attempt++) {
      const states = await relay.query([
        {
          kinds: [REPO_STATE_KIND],
          authors: [maintainer.pubkey],
          "#d": [repo.identifier],
        },
      ]);
      mergedState = states.find((s) => s.id === result.state.id);
      if (!mergedState) await new Promise((r) => setTimeout(r, 250));
    }
    expect(mergedState).toBeDefined();
    const headRefTag = mergedState?.tags.find(
      ([t]) => t === `refs/heads/${repo.branch}`,
    );
    expect(headRefTag?.[1]).toBe(result.mergeCommit.hash);

    // ── 6. Assert: the kind:1631 merged status is queryable ──────────────
    const statuses = await relay.query([
      { kinds: [STATUS_RESOLVED], "#e": [seeded.patch.id] },
    ]);
    expect(statuses.map((e) => e.id)).toContain(result.status.id);
    const mergeCommitTag = result.status.tags.find(
      ([t]) => t === "merge-commit",
    );
    expect(mergeCommitTag?.[1]).toBe(result.mergeCommit.hash);

    // onEvent fired for state + status.
    expect(collectedEvents.map((e) => e.id)).toEqual(
      expect.arrayContaining([result.state.id, result.status.id]),
    );

    // sanity: ZERO_HASH constant is the all-zero ref (documents the push contract)
    expect(ZERO_HASH).toMatch(/^0{40}$/);
  });

  it("seeds a kind:1618 PR branch, builds the merge commit, then merges it to the branch tip", async () => {
    const prRepo = await seedRepo(server, relay, maintainer, {
      identifier: "merge-kind-pr-repo",
      name: "Merge Kind PR Repo",
      files: { "README.md": "# PR repo\n\nbase line\n" },
    });
    const prPool = new GitGraspPool({
      cloneUrls: [prRepo.cloneUrl],
      corsProxyBase: null,
    });

    try {
      // ── 1. Contributor pushes a branch and publishes a kind:1618 PR ──────
      const seeded = await seedKindPR(prRepo, relay, maintainer, contributor, {
        branch: "pr-kind-happy-path",
        path: "PR-FEATURE.md",
        content: "# PR Feature\n\nbranch-backed change\n",
        subject: "Add PR-FEATURE.md",
        body: "Exercises the kind:1618 PR merge path.",
      });

      const prs = await relay.query([
        { kinds: [PR_KIND], authors: [contributor.pubkey] },
      ]);
      expect(prs.map((e) => e.id)).toContain(seeded.pr.id);

      const store = new EventStore();
      const prCast = new PR(seeded.pr, store);
      expect(prCast.subject).toBe("Add PR-FEATURE.md");
      expect(prCast.tipCommitId).toBe(seeded.commit);
      expect(prCast.mergeBase).toBe(prRepo.headCommit);
      expect(prCast.cloneUrls).toEqual([prRepo.cloneUrl]);

      // ── 2. Mirror usePRMergeability's fast-path merge commit build ──────
      const abort = new AbortController();
      const tipData = await prPool.getFullTree(
        seeded.commit,
        abort.signal,
        prCast.cloneUrls,
      );
      expect(tipData).not.toBeNull();

      const mergeBase = await prPool.findMergeBaseBetween(
        prRepo.headCommit,
        seeded.commit,
        abort.signal,
        prCast.cloneUrls,
      );
      expect(mergeBase).toBe(prRepo.headCommit);

      if (!tipData || !mergeBase) {
        throw new Error("PR mergeability setup failed unexpectedly");
      }

      const committer: CommitPerson = {
        name: "maintainer",
        email: `${maintainer.npub}@nostr`,
        timestamp: prRepo.headCommitTimestamp + 120,
        timezone: "+0000",
      };
      const prNevent = buildPRNevent(seeded.pr.id, contributor.pubkey, [
        server.relayUrl,
      ]);
      const mergeCommitObj = await createMergeCommitObject(
        tipData.commit.tree,
        prRepo.headCommit,
        seeded.commit,
        committer,
        {
          rootEventId: seeded.pr.id,
          title: prCast.subject,
          nevent: prNevent,
          authorPubkey: contributor.pubkey,
          description: prCast.body,
        },
      );

      const collectedEvents: NostrEvent[] = [];

      // ── 3. Run the production PR merge orchestration ────────────────────
      const result = await performPRMerge({
        signer: maintainer,
        signerPubkey: maintainer.pubkey,
        mergeCommitObj,
        prTipCommitHash: seeded.commit,
        mergeBase,
        extraObjects: [],
        dTag: prRepo.identifier,
        defaultBranchName: prRepo.branch,
        defaultBranchHead: prRepo.headCommit,
        currentStateEvent: seeded.state,
        repoCoords: [prRepo.coordinate],
        rootEventId: seeded.pr.id,
        rootAuthorPubkey: contributor.pubkey,
        fetchBranchObjects: (tipCommitHash, stopAtCommitHash) =>
          prPool.getPackableObjectsForCommitRange(
            tipCommitHash,
            stopAtCommitHash,
            new AbortController().signal,
            prCast.cloneUrls,
          ),
        publishStateToGrasp: async (state) => {
          await relay.publish(state);
        },
        pushObjects: async (
          objects: PackableObject[],
          refUpdate: RefUpdate,
        ) => {
          const packfile = await createPackfile(objects);
          const pushResult = await pushToGitServer(
            prRepo.cloneUrl,
            [refUpdate],
            packfile,
          );
          if (
            !pushResult.unpackOk ||
            !pushResult.refResults.every((r) => r.ok)
          ) {
            throw new Error(
              `push failed (unpackOk=${pushResult.unpackOk}): ` +
                pushResult.refResults
                  .map((r) => `${r.refName}=${r.ok ? "ok" : r.reason}`)
                  .join(", "),
            );
          }
        },
        publishStatusBroadly: async (status) => {
          await relay.publish(status);
        },
        broadcastStateBroadly: async () => {
          // already published to the only relay we have; no-op
        },
        onEvent: (e) => collectedEvents.push(e),
      });

      // ── 4. Assert: merge commit is the new default branch tip ────────────
      const refs = await getReceivePackRefs(prRepo.cloneUrl);
      expect(refs.refs[`refs/heads/${prRepo.branch}`]).toBe(
        result.mergeCommit.hash,
      );
      expect(refs.refs[`refs/heads/${seeded.branch}`]).toBe(seeded.commit);
      expect(result.mergeCommit.hash).not.toBe(prRepo.headCommit);
      expect(result.mergeCommit.hash).not.toBe(seeded.commit);

      // ── 5. Assert: the kind:30618 state points main at the merge ────────
      let mergedState: NostrEvent | undefined;
      for (let attempt = 0; attempt < 20 && !mergedState; attempt++) {
        const states = await relay.query([
          {
            kinds: [REPO_STATE_KIND],
            authors: [maintainer.pubkey],
            "#d": [prRepo.identifier],
          },
        ]);
        mergedState = states.find((s) => s.id === result.state.id);
        if (!mergedState) await new Promise((r) => setTimeout(r, 250));
      }
      expect(mergedState).toBeDefined();
      const headRefTag = mergedState?.tags.find(
        ([t]) => t === `refs/heads/${prRepo.branch}`,
      );
      expect(headRefTag?.[1]).toBe(result.mergeCommit.hash);
      const prBranchTag = mergedState?.tags.find(
        ([t]) => t === `refs/heads/${seeded.branch}`,
      );
      expect(prBranchTag?.[1]).toBe(seeded.commit);

      // ── 6. Assert: the kind:1631 merged status is queryable ─────────────
      const statuses = await relay.query([
        { kinds: [STATUS_RESOLVED], "#e": [seeded.pr.id] },
      ]);
      expect(statuses.map((e) => e.id)).toContain(result.status.id);
      const mergeCommitTag = result.status.tags.find(
        ([t]) => t === "merge-commit",
      );
      expect(mergeCommitTag?.[1]).toBe(result.mergeCommit.hash);

      expect(collectedEvents.map((e) => e.id)).toEqual(
        expect.arrayContaining([result.state.id, result.status.id]),
      );
      expect(result.pushedObjects.map((o) => o.hash)).toContain(seeded.commit);
    } finally {
      prPool.dispose();
    }
  });
});
