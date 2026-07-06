import { afterEach, describe, expect, it } from "vitest";
import type { NostrEvent } from "nostr-tools";
import { EventStore } from "applesauce-core";
import {
  advanceBranch,
  GraspServer,
  graspBinaryAvailable,
  makePoolTransports,
  RelayClient,
  REPO_STATE_KIND,
  seedKindPR,
  seedMultiServerRepo,
  seedPatchPR,
  seedTag,
  TestSigner,
  type SeededMultiServerRepo,
} from "./harness";
import { Patch } from "@/casts/Patch";
import { PR } from "@/casts/PR";
import {
  buildPRNevent,
  GitGraspPool,
  performMerge,
  performPRMerge,
} from "@/lib/git-grasp-pool";
import {
  createMergeCommitObject,
  buildPatchChainObjects,
} from "@/lib/patch-merge";
import { getReceivePackRefs, ZERO_HASH } from "@/lib/git-push";
import { STATUS_RESOLVED } from "@/lib/nip34";
import type { CommitPerson } from "@/lib/git-objects";

const describeIfGrasp = graspBinaryAvailable() ? describe : describe.skip;

interface MirrorFixture {
  serverA: GraspServer;
  serverB: GraspServer;
  relayA: RelayClient;
  relayB: RelayClient;
  maintainer: TestSigner;
  contributor: TestSigner;
}

async function createFixture(): Promise<MirrorFixture> {
  const serverA = await GraspServer.start({ role: "primary" });
  const serverB = await GraspServer.start({ role: "mirror" });
  const relayA = await RelayClient.connect(serverA.relayUrl);
  const relayB = await RelayClient.connect(serverB.relayUrl);
  return {
    serverA,
    serverB,
    relayA,
    relayB,
    maintainer: new TestSigner(),
    contributor: new TestSigner(),
  };
}

async function disposeFixture(fixture: MirrorFixture | null): Promise<void> {
  fixture?.relayA.close();
  fixture?.relayB.close();
  await fixture?.serverA.stop();
  await fixture?.serverB.stop();
}

async function pollRelayForEvent(
  relay: RelayClient,
  filters: Parameters<RelayClient["query"]>[0],
  eventId: string,
): Promise<NostrEvent | undefined> {
  for (let attempt = 0; attempt < 24; attempt++) {
    const events = await relay.query(filters);
    const event = events.find((candidate) => candidate.id === eventId);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

function makeCommitter(
  repo: SeededMultiServerRepo,
  signer: TestSigner,
): CommitPerson {
  return {
    name: "maintainer",
    email: `${signer.npub}@nostr`,
    timestamp: repo.headCommitTimestamp + 180,
    timezone: "+0000",
  };
}

async function performPatchMergeOnMirrors(params: {
  repo: SeededMultiServerRepo;
  fixture: MirrorFixture;
  pool: GitGraspPool;
  currentStateEvent: NostrEvent;
  targetCloneUrls?: string[];
  relays?: RelayClient[];
}) {
  const { repo, fixture, pool, currentStateEvent } = params;
  const seeded = await seedPatchPR(repo, fixture.relayA, fixture.contributor, {
    path: `PATCH-${repo.identifier}.md`,
    content: `# Patch ${repo.identifier}\n\nmerged through grasp fan-out\n`,
    subject: `Patch ${repo.identifier}`,
  });

  const store = new EventStore();
  const patchCast = new Patch(seeded.patch, store);
  const buildOutcome = await buildPatchChainObjects(
    [patchCast],
    pool,
    new AbortController().signal,
    repo.cloneUrls,
  );
  if ("reason" in buildOutcome) {
    throw new Error(`buildPatchChainObjects failed: ${buildOutcome.reason}`);
  }

  const transports = makePoolTransports(
    pool,
    params.relays ?? [fixture.relayA, fixture.relayB],
    params.targetCloneUrls ?? repo.cloneUrls,
    currentStateEvent,
  );

  const result = await performMerge({
    signer: fixture.maintainer,
    signerPubkey: fixture.maintainer.pubkey,
    chainObjects: buildOutcome.objects,
    finalTreeHash: buildOutcome.finalTreeHash,
    tipCommitHash: buildOutcome.tipCommitHash,
    dTag: repo.identifier,
    defaultBranchName: repo.branch,
    defaultBranchHead: repo.headCommit,
    currentStateEvent,
    repoCoords: [repo.coordinate],
    rootEventId: seeded.patch.id,
    rootAuthorPubkey: fixture.contributor.pubkey,
    subject: patchCast.subject,
    prNevent: buildPRNevent(
      seeded.patch.id,
      fixture.contributor.pubkey,
      repo.relayUrls,
    ),
    committer: makeCommitter(repo, fixture.maintainer),
    patchEventIds: [
      { id: seeded.patch.id, pubkey: fixture.contributor.pubkey },
    ],
    ...transports.transports,
  });

  return { result, seeded, pushSummary: transports.getPushSummary() };
}

async function performPRMergeOnMirrors(params: {
  repo: SeededMultiServerRepo;
  fixture: MirrorFixture;
  pool: GitGraspPool;
  prSeed: Awaited<ReturnType<typeof seedKindPR>>;
  currentStateEvent: NostrEvent;
}) {
  const { repo, fixture, pool, prSeed, currentStateEvent } = params;
  const store = new EventStore();
  const prCast = new PR(prSeed.pr, store);
  const tipData = await pool.getFullTree(
    prSeed.commit,
    new AbortController().signal,
    prCast.cloneUrls,
  );
  const mergeBase = await pool.findMergeBaseBetween(
    repo.headCommit,
    prSeed.commit,
    new AbortController().signal,
    prCast.cloneUrls,
  );
  if (!tipData || !mergeBase) throw new Error("PR mergeability setup failed");

  const mergeCommitObj = await createMergeCommitObject(
    tipData.commit.tree,
    repo.headCommit,
    prSeed.commit,
    makeCommitter(repo, fixture.maintainer),
    {
      rootEventId: prSeed.pr.id,
      title: prCast.subject,
      nevent: buildPRNevent(
        prSeed.pr.id,
        fixture.contributor.pubkey,
        repo.relayUrls,
      ),
      authorPubkey: fixture.contributor.pubkey,
      description: prCast.body,
    },
  );

  const transports = makePoolTransports(
    pool,
    [fixture.relayA, fixture.relayB],
    repo.cloneUrls,
    currentStateEvent,
  );
  const result = await performPRMerge({
    signer: fixture.maintainer,
    signerPubkey: fixture.maintainer.pubkey,
    mergeCommitObj,
    prTipCommitHash: prSeed.commit,
    mergeBase,
    extraObjects: [],
    dTag: repo.identifier,
    defaultBranchName: repo.branch,
    defaultBranchHead: repo.headCommit,
    currentStateEvent,
    repoCoords: [repo.coordinate],
    rootEventId: prSeed.pr.id,
    rootAuthorPubkey: fixture.contributor.pubkey,
    fetchBranchObjects: (tipCommitHash, stopAtCommitHash) =>
      pool.getPackableObjectsForCommitRange(
        tipCommitHash,
        stopAtCommitHash,
        new AbortController().signal,
        prCast.cloneUrls,
      ),
    ...transports.transports,
  });

  return { result, pushSummary: transports.getPushSummary(), prCast };
}

async function expectBranch(
  cloneUrl: string,
  branch: string,
  expectedHash: string,
): Promise<void> {
  const refs = await getReceivePackRefs(cloneUrl);
  expect(refs.refs[`refs/heads/${branch}`]).toBe(expectedHash);
}

describeIfGrasp("e2e — lagging Grasp mirror merge fan-out", () => {
  let fixture: MirrorFixture | null = null;
  let pool: GitGraspPool | null = null;

  afterEach(async () => {
    pool?.dispose();
    pool = null;
    await disposeFixture(fixture);
    fixture = null;
  });

  it("merges a patch when neither server has the patch git data", async () => {
    fixture = await createFixture();
    const repo = await seedMultiServerRepo(
      [fixture.serverA, fixture.serverB],
      [fixture.relayA, fixture.relayB],
      fixture.maintainer,
      { identifier: "patch-missing-git" },
    );
    pool = new GitGraspPool({ cloneUrls: repo.cloneUrls, corsProxyBase: null });

    const { result, seeded, pushSummary } = await performPatchMergeOnMirrors({
      repo,
      fixture,
      pool,
      currentStateEvent: repo.state,
    });

    expect(pushSummary?.successCount).toBe(2);
    expect(pushSummary?.totalCount).toBe(2);
    await expectBranch(
      repo.servers[0].cloneUrl,
      repo.branch,
      result.mergeCommit.hash,
    );
    await expectBranch(
      repo.servers[1].cloneUrl,
      repo.branch,
      result.mergeCommit.hash,
    );
    await expect(
      pollRelayForEvent(
        fixture.relayB,
        [
          {
            kinds: [REPO_STATE_KIND],
            authors: [fixture.maintainer.pubkey],
            "#d": [repo.identifier],
          },
        ],
        result.state.id,
      ),
    ).resolves.toBeDefined();
    await expect(
      pollRelayForEvent(
        fixture.relayB,
        [{ kinds: [STATUS_RESOLVED], "#e": [seeded.patch.id] }],
        result.status.id,
      ),
    ).resolves.toBeDefined();
  }, 90_000);

  it("catches up B's default branch and materialises the missing PR branch", async () => {
    fixture = await createFixture();
    const seededRepo = await seedMultiServerRepo(
      [fixture.serverA, fixture.serverB],
      [fixture.relayA, fixture.relayB],
      fixture.maintainer,
      { identifier: "default-lag-pr-missing" },
    );
    const advanced = await advanceBranch(seededRepo, fixture.maintainer, {
      pushTo: [fixture.serverA],
      publishStateTo: [fixture.relayA, fixture.relayB],
      path: "A-ONLY.md",
      content: "server A receives this first\n",
    });
    const repo = { ...advanced.repo, servers: seededRepo.servers };
    const prSeed = await seedKindPR(
      repo,
      fixture.relayA,
      fixture.maintainer,
      fixture.contributor,
      {
        branch: "pr/a-only",
        path: "PR.md",
        content: "PR branch only exists on A before merge\n",
        subject: "Add PR branch",
        publishStateTo: [fixture.relayA, fixture.relayB],
      },
    );
    if (!prSeed.state) throw new Error("seedKindPR did not publish state");
    pool = new GitGraspPool({ cloneUrls: repo.cloneUrls, corsProxyBase: null });

    const { result, pushSummary } = await performPRMergeOnMirrors({
      repo,
      fixture,
      pool,
      prSeed,
      currentStateEvent: prSeed.state,
    });

    expect(pushSummary?.successCount).toBe(2);
    const refsB = await getReceivePackRefs(repo.servers[1].cloneUrl);
    expect(refsB.refs[`refs/heads/${repo.branch}`]).toBe(
      result.mergeCommit.hash,
    );
    expect(refsB.refs[`refs/heads/${prSeed.branch}`]).toBe(prSeed.commit);
    const bOnlyPool = new GitGraspPool({
      cloneUrls: [repo.servers[1].cloneUrl],
      corsProxyBase: null,
    });
    try {
      const caughtUpCommit = await bOnlyPool.getSingleCommit(
        advanced.commit,
        new AbortController().signal,
      );
      expect(caughtUpCommit?.hash).toBe(advanced.commit);
    } finally {
      bOnlyPool.dispose();
    }
    const refsA = await getReceivePackRefs(repo.servers[0].cloneUrl);
    expect(refsA.refs[`refs/heads/${repo.branch}`]).toBe(
      result.mergeCommit.hash,
    );
    expect(refsA.refs[`refs/heads/${prSeed.branch}`]).toBe(prSeed.commit);
  }, 90_000);

  it("preserves a tag that only A knew about and pushes it to B with the merge", async () => {
    fixture = await createFixture();
    const seededRepo = await seedMultiServerRepo(
      [fixture.serverA, fixture.serverB],
      [fixture.relayA, fixture.relayB],
      fixture.maintainer,
      { identifier: "tag-preservation" },
    );
    pool = new GitGraspPool({
      cloneUrls: seededRepo.cloneUrls,
      corsProxyBase: null,
    });
    const tag = await seedTag(seededRepo, fixture.maintainer, {
      name: "v1.0.0",
      includeInStateTo: [fixture.relayA],
    });
    const repo = { ...tag.repo, servers: seededRepo.servers };

    const { result, pushSummary } = await performPatchMergeOnMirrors({
      repo,
      fixture,
      pool,
      currentStateEvent: tag.state,
    });

    expect(pushSummary?.successCount).toBe(2);
    const tagInMergedState = result.state.tags.find(
      ([name]) => name === tag.refName,
    );
    expect(tagInMergedState?.[1]).toBe(tag.commit);
    const refsB = await getReceivePackRefs(repo.servers[1].cloneUrl);
    expect(refsB.refs[`refs/heads/${repo.branch}`]).toBe(
      result.mergeCommit.hash,
    );
    expect(refsB.refs[tag.refName]).toBe(tag.commit);
  }, 90_000);

  it("creates the default branch on a fresh mirror that had no branch", async () => {
    fixture = await createFixture();
    const repo = await seedMultiServerRepo(
      [fixture.serverA, fixture.serverB],
      [fixture.relayA, fixture.relayB],
      fixture.maintainer,
      { identifier: "fresh-mirror", pushInitialTo: [fixture.serverA] },
    );
    const refsBefore = await getReceivePackRefs(repo.servers[1].cloneUrl);
    expect(refsBefore.refs[`refs/heads/${repo.branch}`]).toBeUndefined();
    pool = new GitGraspPool({ cloneUrls: repo.cloneUrls, corsProxyBase: null });

    const { result, pushSummary } = await performPatchMergeOnMirrors({
      repo,
      fixture,
      pool,
      currentStateEvent: repo.state,
    });

    expect(pushSummary?.successCount).toBe(2);
    expect(pushSummary?.totalCount).toBe(2);
    await expectBranch(
      repo.servers[0].cloneUrl,
      repo.branch,
      result.mergeCommit.hash,
    );
    await expectBranch(
      repo.servers[1].cloneUrl,
      repo.branch,
      result.mergeCommit.hash,
    );
    expect(ZERO_HASH).toMatch(/^0{40}$/);
  }, 90_000);

  it("keeps the merge successful when B is down and records B's failure", async () => {
    fixture = await createFixture();
    const repo = await seedMultiServerRepo(
      [fixture.serverA, fixture.serverB],
      [fixture.relayA, fixture.relayB],
      fixture.maintainer,
      { identifier: "partial-delivery" },
    );
    pool = new GitGraspPool({ cloneUrls: repo.cloneUrls, corsProxyBase: null });
    await fixture.serverB.stop();

    const { result, pushSummary } = await performPatchMergeOnMirrors({
      repo,
      fixture,
      pool,
      currentStateEvent: repo.state,
    });

    expect(pushSummary?.successCount).toBe(1);
    expect(pushSummary?.totalCount).toBe(2);
    const bOutcome = pushSummary?.outcomes.find(
      (outcome) => outcome.cloneUrl === repo.servers[1].cloneUrl,
    );
    expect(bOutcome?.ok).toBe(false);
    expect(bOutcome?.message.length).toBeGreaterThan(0);
    await expectBranch(
      repo.servers[0].cloneUrl,
      repo.branch,
      result.mergeCommit.hash,
    );
    await expect(
      pollRelayForEvent(
        fixture.relayA,
        [
          {
            kinds: [REPO_STATE_KIND],
            authors: [fixture.maintainer.pubkey],
            "#d": [repo.identifier],
          },
        ],
        result.state.id,
      ),
    ).resolves.toBeDefined();
  }, 90_000);

  it("reports B's authorisation rejection verbatim when the merged state never reaches B's relay", async () => {
    fixture = await createFixture();
    const repo = await seedMultiServerRepo(
      [fixture.serverA, fixture.serverB],
      [fixture.relayA, fixture.relayB],
      fixture.maintainer,
      { identifier: "missing-purgatory-on-b" },
    );
    pool = new GitGraspPool({ cloneUrls: repo.cloneUrls, corsProxyBase: null });

    const { result, pushSummary } = await performPatchMergeOnMirrors({
      repo,
      fixture,
      pool,
      currentStateEvent: repo.state,
      relays: [fixture.relayA],
    });

    expect(pushSummary?.successCount).toBe(1);
    expect(pushSummary?.totalCount).toBe(2);
    const bOutcome = pushSummary?.outcomes.find(
      (outcome) => outcome.cloneUrl === repo.servers[1].cloneUrl,
    );
    expect(bOutcome?.ok).toBe(false);
    expect(bOutcome?.message).toMatch(/server rejected push:.*authoris/i);
    await expectBranch(
      repo.servers[0].cloneUrl,
      repo.branch,
      result.mergeCommit.hash,
    );
  }, 90_000);
});
