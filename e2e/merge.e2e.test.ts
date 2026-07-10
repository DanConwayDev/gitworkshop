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
 * (see `src/lib/git-grasp-pool/merge.ts`); the React component now calls the
 * same function, so this test covers the production path. Test transport wiring
 * mirrors MergePanel: state/status publish ONLY to the local grasp relay (via
 * `RelayClient`) and `pushObjects` goes through `pool.pushRefUpdate` so the
 * production grasp fan-out path is exercised — never `@/services/nostr`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { NostrEvent } from "nostr-tools";
import { EventStore } from "applesauce-core";
import {
  GraspServer,
  RelayClient,
  TestSigner,
  advanceBranch,
  seedRepo,
  seedTag,
  seedPatchPR,
  seedKindPR,
  makePoolTransports,
  graspBinaryAvailable,
  REPO_STATE_KIND,
  buildStateWithRefs,
  waitUntilAfterUnixSecond,
  type SeededRepo,
} from "./harness";
import { Patch } from "@/casts/Patch";
import { PR } from "@/casts/PR";
import { IssueFactory } from "@/factories/IssueFactory";
import {
  createMergeCommitObject,
  buildPatchChainObjects,
  type PatchChainBuildResult,
} from "@/lib/patch-merge";
import {
  performMerge,
  buildPRNevent,
  performPRMerge,
} from "@/lib/git-grasp-pool";
import { GitGraspPool } from "@/lib/git-grasp-pool";
import { getReceivePackRefs, ZERO_HASH } from "@/lib/git-push";
import { gitObjectBytes, sha1hex, type CommitPerson } from "@/lib/git-objects";
import type { PackableObject } from "@/lib/git-packfile";
import { ISSUE_KIND, PR_KIND, STATUS_RESOLVED } from "@/lib/nip34";

const describeIfGrasp = graspBinaryAvailable() ? describe : describe.skip;

// Runs whenever the ngit-grasp binary is available (NGIT_GRASP_BIN or a sibling
// clone); skips cleanly otherwise. The earlier GitGraspPool fetch blocker
// (`indexedDB is not defined` in node — see e2e/HANDOFF.md) is fixed in
// src/lib/git-grasp-pool/cache.ts, so the full merge path runs end-to-end here.
const describeMerge = describeIfGrasp;

async function packAnnotatedTag(params: {
  name: string;
  targetCommit: string;
  tagger: CommitPerson;
  message: string;
}): Promise<PackableObject> {
  const message = params.message.endsWith("\n")
    ? params.message
    : `${params.message}\n`;
  const content = new TextEncoder().encode(
    `object ${params.targetCommit}\n` +
      `type commit\n` +
      `tag ${params.name}\n` +
      `tagger ${params.tagger.name} <${params.tagger.email}> ` +
      `${params.tagger.timestamp} ${params.tagger.timezone}\n` +
      `\n` +
      message,
  );

  return {
    type: "tag",
    data: content,
    hash: await sha1hex(gitObjectBytes("tag", content)),
  };
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

    const transports = makePoolTransports(
      pool,
      [relay],
      [repo.cloneUrl],
      repo.state,
    );

    const result = await performMerge({
      signer: maintainer,
      signerPubkey: maintainer.pubkey,
      chainObjects: buildResult.objects,
      finalTreeHash: buildResult.finalTreeHash,
      tipCommitHash: buildResult.tipCommitHash,
      dTag: repo.identifier,
      defaultBranchName: repo.branch,
      defaultBranchHead: repo.headCommit,
      currentStateEvent: repo.state,
      repoCoords: [repo.coordinate],
      rootEventId: seeded.patch.id,
      rootAuthorPubkey: contributor.pubkey,
      subject: patchCast.subject,
      prNevent: "nevent1test",
      committer,
      patchEventIds: [{ id: seeded.patch.id, pubkey: contributor.pubkey }],
      ...transports.transports,
    });
    expect(transports.getPushSummary()?.successCount).toBe(1);

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
    expect(transports.events.map((e) => e.id)).toEqual(
      expect.arrayContaining([result.state.id, result.status.id]),
    );

    // sanity: ZERO_HASH constant is the all-zero ref (documents the push contract)
    expect(ZERO_HASH).toMatch(/^0{40}$/);
  });

  it("auto-resolves an open issue referenced by a commit being merged", async () => {
    const issueRepo = await seedRepo(server, relay, maintainer, {
      identifier: "merge-issue-auto-resolve-repo",
      name: "Merge Issue Auto-Resolve Repo",
      files: { "README.md": "# issue auto-resolve repo\n\nbase line\n" },
    });
    const issuePool = new GitGraspPool({
      cloneUrls: [issueRepo.cloneUrl],
      corsProxyBase: null,
    });

    try {
      const issue = await IssueFactory.create(
        issueRepo.coordinate,
        issueRepo.pubkey,
        "Document the merge path",
        "The merge should publish an issue-resolution status.",
      ).sign(contributor);
      await relay.publish(issue);

      const issues = await relay.query([
        { kinds: [ISSUE_KIND], authors: [contributor.pubkey] },
      ]);
      expect(issues.map((event) => event.id)).toContain(issue.id);

      const issueRef = `#${issue.id.slice(0, 8)}`;
      const seeded = await seedPatchPR(issueRepo, relay, contributor, {
        path: "ISSUE-FIX.md",
        content: "# Issue fix\n\nmerged through the web flow\n",
        subject: "Add issue fix note",
        body: `Fixes ${issueRef}`,
      });

      const store = new EventStore();
      const patchCast = new Patch(seeded.patch, store);
      const buildOutcome = await buildPatchChainObjects(
        [patchCast],
        issuePool,
        new AbortController().signal,
        [issueRepo.cloneUrl],
      );
      if ("reason" in buildOutcome) {
        throw new Error(
          `buildPatchChainObjects failed: ${buildOutcome.reason}`,
        );
      }

      const transports = makePoolTransports(
        issuePool,
        [relay],
        [issueRepo.cloneUrl],
        issueRepo.state,
      );
      const result = await performMerge({
        signer: maintainer,
        signerPubkey: maintainer.pubkey,
        chainObjects: buildOutcome.objects,
        finalTreeHash: buildOutcome.finalTreeHash,
        tipCommitHash: buildOutcome.tipCommitHash,
        dTag: issueRepo.identifier,
        defaultBranchName: issueRepo.branch,
        defaultBranchHead: issueRepo.headCommit,
        currentStateEvent: issueRepo.state,
        repoCoords: [issueRepo.coordinate],
        rootEventId: seeded.patch.id,
        rootAuthorPubkey: contributor.pubkey,
        subject: patchCast.subject,
        prNevent: buildPRNevent(seeded.patch.id, contributor.pubkey, [
          server.relayUrl,
        ]),
        committer: {
          name: "maintainer",
          email: `${maintainer.npub}@nostr`,
          timestamp: issueRepo.headCommitTimestamp + 180,
          timezone: "+0000",
        },
        patchEventIds: [{ id: seeded.patch.id, pubkey: contributor.pubkey }],
        issueAutoResolve: {
          issues: [{ id: issue.id, pubkey: issue.pubkey, status: "open" }],
          maintainers: [maintainer.pubkey],
        },
        ...transports.transports,
      });

      expect(transports.getPushSummary()?.successCount).toBe(1);
      const refs = await getReceivePackRefs(issueRepo.cloneUrl);
      expect(refs.refs[`refs/heads/${issueRepo.branch}`]).toBe(
        result.mergeCommit.hash,
      );

      expect(result.issueStatuses).toHaveLength(1);
      const [issueStatus] = result.issueStatuses;
      expect(issueStatus.kind).toBe(STATUS_RESOLVED);
      expect(issueStatus.pubkey).toBe(maintainer.pubkey);
      expect(issueStatus.tags).toContainEqual(["e", issue.id, "", "root"]);
      expect(issueStatus.tags).toContainEqual(["a", issueRepo.coordinate]);
      expect(issueStatus.tags).toContainEqual(["r", seeded.commit]);
      expect(issueStatus.tags).toContainEqual(["r", result.mergeCommit.hash]);
      expect(issueStatus.tags).toContainEqual([
        "alt",
        "issue resolved from commit message",
      ]);
      expect(issueStatus.content).toBe(
        `Fixes ${issueRef}\n\n` +
          `resolved by commit ${seeded.commit}, when merged in commit ${result.mergeCommit.hash}`,
      );

      const statuses = await relay.query([
        { kinds: [STATUS_RESOLVED], "#e": [issue.id] },
      ]);
      expect(statuses.map((event) => event.id)).toContain(issueStatus.id);
      expect(transports.events.map((event) => event.id)).toEqual(
        expect.arrayContaining([
          result.state.id,
          result.status.id,
          issueStatus.id,
        ]),
      );
    } finally {
      issuePool.dispose();
    }
  });

  it("auto-resolves issues from authoritative git commits ahead of the signed state", async () => {
    const issueRepo = await seedRepo(server, relay, maintainer, {
      identifier: "merge-git-ahead-issue-auto-resolve-repo",
      name: "Merge Git-Ahead Issue Auto-Resolve Repo",
      files: { "README.md": "# git-ahead issue auto-resolve repo\n\nbase\n" },
    });
    const issuePool = new GitGraspPool({
      cloneUrls: [issueRepo.cloneUrl],
      corsProxyBase: null,
    });

    try {
      const gitAheadIssue = await IssueFactory.create(
        issueRepo.coordinate,
        issueRepo.pubkey,
        "Resolve from git-ahead commit",
        "The signed state is behind the commit that references this issue.",
      ).sign(contributor);
      const patchIssue = await IssueFactory.create(
        issueRepo.coordinate,
        issueRepo.pubkey,
        "Resolve from patch commit",
        "The branch being merged should still be scanned.",
      ).sign(contributor);
      await relay.publish(gitAheadIssue);
      await relay.publish(patchIssue);

      const gitAheadRef = `#${gitAheadIssue.id.slice(0, 8)}`;
      const advancedB = await advanceBranch(issueRepo, maintainer, {
        pushTo: [server],
        publishStateTo: [relay],
        path: "B.md",
        content: "B is on git but not yet in signed state\n",
        message: `B on authoritative git\n\nFixes ${gitAheadRef}`,
      });
      const advancedC = await advanceBranch(advancedB.repo, maintainer, {
        pushTo: [server],
        publishStateTo: [relay],
        path: "C.md",
        content: "C is on git but not yet in signed state\n",
        message: "C on authoritative git",
      });
      const advancedD = await advanceBranch(advancedC.repo, maintainer, {
        pushTo: [server],
        publishStateTo: [relay],
        path: "D.md",
        content: "D is the authoritative git head\n",
        message: "D on authoritative git",
      });
      const gitAheadRepo: SeededRepo = {
        ...advancedD.repo,
      };

      const patchIssueRef = `#${patchIssue.id.slice(0, 8)}`;
      const seeded = await seedPatchPR(gitAheadRepo, relay, contributor, {
        path: "PATCH-FIX.md",
        content: "# Patch fix\n\nmerged through the web flow\n",
        subject: "Add patch fix note",
        body: `Fixes ${patchIssueRef}`,
      });

      const store = new EventStore();
      const patchCast = new Patch(seeded.patch, store);
      const buildOutcome = await buildPatchChainObjects(
        [patchCast],
        issuePool,
        new AbortController().signal,
        [issueRepo.cloneUrl],
      );
      if ("reason" in buildOutcome) {
        throw new Error(
          `buildPatchChainObjects failed: ${buildOutcome.reason}`,
        );
      }

      const staleState = buildStateWithRefs(maintainer, {
        identifier: issueRepo.identifier,
        refs: [
          {
            name: `refs/heads/${issueRepo.branch}`,
            commitHash: issueRepo.headCommit,
          },
        ],
        headBranch: issueRepo.branch,
      });

      const transports = makePoolTransports(
        issuePool,
        [relay],
        [issueRepo.cloneUrl],
        staleState,
      );
      const result = await performMerge({
        signer: maintainer,
        signerPubkey: maintainer.pubkey,
        chainObjects: buildOutcome.objects,
        finalTreeHash: buildOutcome.finalTreeHash,
        tipCommitHash: buildOutcome.tipCommitHash,
        dTag: issueRepo.identifier,
        defaultBranchName: issueRepo.branch,
        defaultBranchHead: gitAheadRepo.headCommit,
        currentStateEvent: staleState,
        repoCoords: [issueRepo.coordinate],
        rootEventId: seeded.patch.id,
        rootAuthorPubkey: contributor.pubkey,
        subject: patchCast.subject,
        prNevent: buildPRNevent(seeded.patch.id, contributor.pubkey, [
          server.relayUrl,
        ]),
        committer: {
          name: "maintainer",
          email: `${maintainer.npub}@nostr`,
          timestamp: advancedD.repo.headCommitTimestamp + 180,
          timezone: "+0000",
        },
        patchEventIds: [{ id: seeded.patch.id, pubkey: contributor.pubkey }],
        issueScanObjects: [
          ...advancedB.objects,
          ...advancedC.objects,
          ...advancedD.objects,
        ],
        issueAutoResolve: {
          issues: [
            {
              id: gitAheadIssue.id,
              pubkey: gitAheadIssue.pubkey,
              status: "open",
            },
            { id: patchIssue.id, pubkey: patchIssue.pubkey, status: "open" },
          ],
          maintainers: [maintainer.pubkey],
        },
        ...transports.transports,
      });

      expect(transports.getPushSummary()?.successCount).toBe(1);
      const refs = await getReceivePackRefs(issueRepo.cloneUrl);
      expect(refs.refs[`refs/heads/${issueRepo.branch}`]).toBe(
        result.mergeCommit.hash,
      );

      expect(result.issueStatuses).toHaveLength(2);
      const gitAheadStatus = result.issueStatuses.find((status) =>
        status.tags.some(
          ([name, value, , marker]) =>
            name === "e" && value === gitAheadIssue.id && marker === "root",
        ),
      );
      const patchStatus = result.issueStatuses.find((status) =>
        status.tags.some(
          ([name, value, , marker]) =>
            name === "e" && value === patchIssue.id && marker === "root",
        ),
      );

      expect(gitAheadStatus).toBeDefined();
      expect(gitAheadStatus?.kind).toBe(STATUS_RESOLVED);
      expect(gitAheadStatus?.pubkey).toBe(maintainer.pubkey);
      expect(gitAheadStatus?.tags).toContainEqual(["a", issueRepo.coordinate]);
      expect(gitAheadStatus?.tags).toContainEqual(["r", advancedB.commit]);
      expect(gitAheadStatus?.tags).toContainEqual([
        "r",
        result.mergeCommit.hash,
      ]);
      expect(gitAheadStatus?.content).toBe(
        `Fixes ${gitAheadRef}\n\n` +
          `resolved by commit ${advancedB.commit}, when merged in commit ${result.mergeCommit.hash}`,
      );

      expect(patchStatus).toBeDefined();
      expect(patchStatus?.tags).toContainEqual(["r", seeded.commit]);
      expect(patchStatus?.tags).toContainEqual(["r", result.mergeCommit.hash]);
      expect(patchStatus?.content).toBe(
        `Fixes ${patchIssueRef}\n\n` +
          `resolved by commit ${seeded.commit}, when merged in commit ${result.mergeCommit.hash}`,
      );

      const relayStatuses = await relay.query([
        {
          kinds: [STATUS_RESOLVED],
          "#e": [gitAheadIssue.id, patchIssue.id],
        },
      ]);
      expect(relayStatuses.map((event) => event.id)).toEqual(
        expect.arrayContaining(
          result.issueStatuses.map((issueStatus) => issueStatus.id),
        ),
      );
      expect(transports.events.map((event) => event.id)).toEqual(
        expect.arrayContaining([
          result.state.id,
          result.status.id,
          ...result.issueStatuses.map((issueStatus) => issueStatus.id),
        ]),
      );
    } finally {
      issuePool.dispose();
    }
  }, 90_000);

  it("merges a patch when an in-sync repo has an annotated tag plus another branch", async () => {
    const taggedRepo = await seedRepo(server, relay, maintainer, {
      identifier: "merge-tagged-in-sync-repo",
      name: "Merge Tagged In-Sync Repo",
      files: { "README.md": "# tagged repo\n\nbase line\n" },
    });
    const taggedPool = new GitGraspPool({
      cloneUrls: [taggedRepo.cloneUrl],
      corsProxyBase: null,
    });

    try {
      const extraBranch = await seedKindPR(
        taggedRepo,
        relay,
        maintainer,
        contributor,
        {
          branch: "release/extra-branch",
          path: "EXTRA-BRANCH.md",
          content: "this branch exists before the merge\n",
          subject: "Seed extra branch",
        },
      );
      if (!extraBranch.state) throw new Error("extra branch state missing");

      const repoWithBranch: SeededRepo = {
        ...taggedRepo,
        state: extraBranch.state,
      };
      const tagger: CommitPerson = {
        name: "maintainer",
        email: `${maintainer.npub}@nostr`,
        timestamp: taggedRepo.headCommitTimestamp + 90,
        timezone: "+0000",
      };
      const annotatedTagObject = await packAnnotatedTag({
        name: "v1.0.0",
        targetCommit: taggedRepo.headCommit,
        tagger,
        message: "Release v1.0.0",
      });
      const annotatedTag = await seedTag(repoWithBranch, maintainer, {
        name: "v1.0.0",
        commit: annotatedTagObject.hash,
        objects: [annotatedTagObject],
        pushTo: [server],
        includeInStateTo: [relay],
      });

      const refMap = new Map<string, string>();
      for (const [name, hash] of annotatedTag.state.tags) {
        if (name?.startsWith("refs/") && hash) refMap.set(name, hash);
      }
      refMap.set(`${annotatedTag.refName}^{}`, taggedRepo.headCommit);
      const currentState = buildStateWithRefs(maintainer, {
        identifier: taggedRepo.identifier,
        refs: [...refMap].map(([name, commitHash]) => ({ name, commitHash })),
        headBranch: taggedRepo.branch,
      });
      await relay.publish(currentState);
      await waitUntilAfterUnixSecond(currentState.created_at);

      const refsBefore = await getReceivePackRefs(taggedRepo.cloneUrl);
      expect(refsBefore.refs[`refs/heads/${taggedRepo.branch}`]).toBe(
        taggedRepo.headCommit,
      );
      expect(refsBefore.refs[`refs/heads/${extraBranch.branch}`]).toBe(
        extraBranch.commit,
      );
      expect(refsBefore.refs[annotatedTag.refName]).toBe(
        annotatedTagObject.hash,
      );

      const seeded = await seedPatchPR(taggedRepo, relay, contributor, {
        path: "TAGGED-MERGE.md",
        content: "# Tagged merge\n\nmerge while preserving existing refs\n",
        subject: "Merge with existing refs",
      });
      const store = new EventStore();
      const patchCast = new Patch(seeded.patch, store);
      const buildOutcome = await buildPatchChainObjects(
        [patchCast],
        taggedPool,
        new AbortController().signal,
        [taggedRepo.cloneUrl],
      );
      if ("reason" in buildOutcome) {
        throw new Error(
          `buildPatchChainObjects failed: ${buildOutcome.reason}`,
        );
      }

      const transports = makePoolTransports(
        taggedPool,
        [relay],
        [taggedRepo.cloneUrl],
        currentState,
      );
      const result = await performMerge({
        signer: maintainer,
        signerPubkey: maintainer.pubkey,
        chainObjects: buildOutcome.objects,
        finalTreeHash: buildOutcome.finalTreeHash,
        tipCommitHash: buildOutcome.tipCommitHash,
        dTag: taggedRepo.identifier,
        defaultBranchName: taggedRepo.branch,
        defaultBranchHead: taggedRepo.headCommit,
        currentStateEvent: currentState,
        repoCoords: [taggedRepo.coordinate],
        rootEventId: seeded.patch.id,
        rootAuthorPubkey: contributor.pubkey,
        subject: patchCast.subject,
        prNevent: buildPRNevent(seeded.patch.id, contributor.pubkey, [
          server.relayUrl,
        ]),
        committer: {
          name: "maintainer",
          email: `${maintainer.npub}@nostr`,
          timestamp: taggedRepo.headCommitTimestamp + 180,
          timezone: "+0000",
        },
        patchEventIds: [{ id: seeded.patch.id, pubkey: contributor.pubkey }],
        ...transports.transports,
      });

      expect(transports.getPushSummary()?.successCount).toBe(1);
      const refsAfter = await getReceivePackRefs(taggedRepo.cloneUrl);
      expect(refsAfter.refs[`refs/heads/${taggedRepo.branch}`]).toBe(
        result.mergeCommit.hash,
      );
      expect(refsAfter.refs[`refs/heads/${extraBranch.branch}`]).toBe(
        extraBranch.commit,
      );
      expect(refsAfter.refs[annotatedTag.refName]).toBe(
        annotatedTagObject.hash,
      );

      expect(
        result.state.tags.find(([name]) => name === annotatedTag.refName)?.[1],
      ).toBe(annotatedTagObject.hash);
      expect(
        result.state.tags.find(
          ([name]) => name === `${annotatedTag.refName}^{}`,
        )?.[1],
      ).toBe(taggedRepo.headCommit);
      expect(
        result.state.tags.find(
          ([name]) => name === `refs/heads/${extraBranch.branch}`,
        )?.[1],
      ).toBe(extraBranch.commit);
    } finally {
      taggedPool.dispose();
    }
  }, 90_000);

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

      const transports = makePoolTransports(
        prPool,
        [relay],
        [prRepo.cloneUrl],
        seeded.state,
      );

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
        ...transports.transports,
      });
      expect(transports.getPushSummary()?.successCount).toBe(1);

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

      expect(transports.events.map((e) => e.id)).toEqual(
        expect.arrayContaining([result.state.id, result.status.id]),
      );
      expect(result.pushedObjects.map((o) => o.hash)).toContain(seeded.commit);
    } finally {
      prPool.dispose();
    }
  });
});
