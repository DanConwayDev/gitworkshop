import { afterEach, describe, expect, it } from "vitest";
import type { NostrEvent } from "nostr-tools";
import { EventStore } from "applesauce-core";
import {
  advanceBranch,
  buildAnnouncement,
  buildStateWithRefs,
  GraspServer,
  graspBinaryAvailable,
  makePoolTransports,
  RelayClient,
  seedKindPR,
  seedRepo,
  TestSigner,
  waitUntilAfterUnixSecond,
  type AdvanceBranchResult,
  type SeededKindPR,
  type SeededRepo,
} from "./harness";
import { PR } from "@/casts/PR";
import {
  buildPRNevent,
  GitGraspPool,
  performPRMerge,
} from "@/lib/git-grasp-pool";
import { createMergeCommitObject } from "@/lib/patch-merge";
import { createPackfile, type PackableObject } from "@/lib/git-packfile";
import { getReceivePackRefs, pushToGitServer, ZERO_HASH } from "@/lib/git-push";
import type { CommitPerson } from "@/lib/git-objects";

const describeIfGrasp = graspBinaryAvailable() ? describe : describe.skip;

interface ForkFixture {
  serverA: GraspServer;
  serverB: GraspServer;
  relayA: RelayClient;
  relayB: RelayClient;
  maintainer: TestSigner;
  contributor: TestSigner;
}

interface ForkSetup {
  forkUrl: string;
  prSeed: SeededKindPR;
  refsBeforeMerge: Record<string, string>;
}

async function createFixture(): Promise<ForkFixture> {
  const serverA = await GraspServer.start({ role: "upstream" });
  const serverB = await GraspServer.start({ role: "fork" });
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

async function disposeFixture(fixture: ForkFixture | null): Promise<void> {
  fixture?.relayA.close();
  fixture?.relayB.close();
  await fixture?.serverA.stop();
  await fixture?.serverB.stop();
}

function makeCommitter(repo: SeededRepo, signer: TestSigner): CommitPerson {
  return {
    name: "maintainer",
    email: `${signer.npub}@nostr`,
    timestamp: repo.headCommitTimestamp + 240,
    timezone: "+0000",
  };
}

async function publishForkAnnouncement(params: {
  fixture: ForkFixture;
  repo: SeededRepo;
  forkUrl: string;
}): Promise<void> {
  const announcement = buildAnnouncement(params.fixture.contributor, {
    identifier: params.repo.identifier,
    name: `${params.repo.identifier} fork`,
    description: "contributor fork for PR e2e",
    cloneUrls: [params.forkUrl],
    relayUrls: [params.fixture.relayB.url],
    eucCommitHash: params.repo.headCommit,
  });
  await params.fixture.relayB.publish(announcement);
}

async function pushForkDefault(params: {
  fixture: ForkFixture;
  repo: SeededRepo;
  forkUrl: string;
  defaultObjects: PackableObject[];
}): Promise<void> {
  const state = buildStateWithRefs(params.fixture.contributor, {
    identifier: params.repo.identifier,
    refs: [
      {
        name: `refs/heads/${params.repo.branch}`,
        commitHash: params.repo.headCommit,
      },
    ],
    headBranch: params.repo.branch,
  });
  await params.fixture.relayB.publish(state);
  await waitUntilAfterUnixSecond(state.created_at);

  const packfile = await createPackfile(params.defaultObjects);
  const result = await pushToGitServer(
    params.forkUrl,
    [
      {
        oldHash: ZERO_HASH,
        newHash: params.repo.headCommit,
        refName: `refs/heads/${params.repo.branch}`,
      },
    ],
    packfile,
  );
  if (!result.unpackOk || !result.refResults.every((ref) => ref.ok)) {
    throw new Error(
      `pushForkDefault failed (unpackOk=${result.unpackOk}): ` +
        result.refResults
          .map((ref) => `${ref.refName}=${ref.ok ? "ok" : ref.reason}`)
          .join(", "),
    );
  }
}

async function seedForkPR(params: {
  fixture: ForkFixture;
  repo: SeededRepo;
  forkUrl: string;
  defaultObjects: PackableObject[];
  branch: string;
}): Promise<ForkSetup> {
  await publishForkAnnouncement(params);
  await pushForkDefault(params);
  const prSeed = await seedKindPR(
    params.repo,
    params.fixture.relayA,
    params.fixture.maintainer,
    params.fixture.contributor,
    {
      branch: params.branch,
      path: `${params.branch.replace(/[^a-z0-9-]/gi, "-")}.md`,
      content: `fork-only PR branch ${params.branch}\n`,
      subject: `Fork PR ${params.branch}`,
      body: "The PR branch only exists on the contributor fork.",
      cloneUrl: params.forkUrl,
      pushCloneUrl: params.forkUrl,
      publishStateTo: [params.fixture.relayB],
      stateSigner: params.fixture.contributor,
    },
  );
  const refsBeforeMerge = (await getReceivePackRefs(params.forkUrl)).refs;
  return { forkUrl: params.forkUrl, prSeed, refsBeforeMerge };
}

async function upstreamObjectsFromPool(
  pool: GitGraspPool,
  repo: SeededRepo,
): Promise<PackableObject[]> {
  const objects = await pool.getPackableObjectsForCommitRange(
    repo.headCommit,
    "",
    new AbortController().signal,
  );
  if (!objects) throw new Error("could not fetch upstream seed objects");
  return objects;
}

async function performForkPRMerge(params: {
  fixture: ForkFixture;
  repo: SeededRepo;
  pool: GitGraspPool;
  fork: ForkSetup;
  currentStateEvent: NostrEvent;
}) {
  const { fixture, repo, pool, fork, currentStateEvent } = params;
  const store = new EventStore();
  const prCast = new PR(fork.prSeed.pr, store);
  expect(prCast.cloneUrls).toEqual([fork.forkUrl]);

  const tipData = await pool.getFullTree(
    fork.prSeed.commit,
    new AbortController().signal,
    prCast.cloneUrls,
  );
  const mergeBase = prCast.mergeBase;
  if (!tipData || !mergeBase)
    throw new Error("fork PR mergeability setup failed");
  expect(mergeBase).toBe(repo.headCommit);

  const mergeCommitObj = await createMergeCommitObject(
    tipData.commit.tree,
    repo.headCommit,
    fork.prSeed.commit,
    makeCommitter(repo, fixture.maintainer),
    {
      rootEventId: fork.prSeed.pr.id,
      title: prCast.subject,
      nevent: buildPRNevent(fork.prSeed.pr.id, fixture.contributor.pubkey, [
        fixture.relayB.url,
      ]),
      authorPubkey: fixture.contributor.pubkey,
      description: prCast.body,
    },
  );

  const transports = makePoolTransports(
    pool,
    [fixture.relayA],
    [repo.cloneUrl],
    currentStateEvent,
    { fallbackUrls: prCast.cloneUrls },
  );
  const result = await performPRMerge({
    signer: fixture.maintainer,
    signerPubkey: fixture.maintainer.pubkey,
    mergeCommitObj,
    prTipCommitHash: fork.prSeed.commit,
    mergeBase,
    extraObjects: [],
    dTag: repo.identifier,
    defaultBranchName: repo.branch,
    defaultBranchHead: repo.headCommit,
    currentStateEvent,
    repoCoords: [repo.coordinate],
    rootEventId: fork.prSeed.pr.id,
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

  return { result, pushSummary: transports.getPushSummary() };
}

async function expectForkUnchanged(fork: ForkSetup): Promise<void> {
  const refsAfterMerge = (await getReceivePackRefs(fork.forkUrl)).refs;
  expect(refsAfterMerge).toEqual(fork.refsBeforeMerge);
}

describeIfGrasp("e2e — fork PR merge fallback fetches", () => {
  let fixture: ForkFixture | null = null;
  let pool: GitGraspPool | null = null;

  afterEach(async () => {
    pool?.dispose();
    pool = null;
    await disposeFixture(fixture);
    fixture = null;
  });

  it("fetches PR git data from the fork clone tag and pushes only to upstream", async () => {
    fixture = await createFixture();
    const repo = await seedRepo(
      fixture.serverA,
      fixture.relayA,
      fixture.maintainer,
      {
        identifier: "fork-pr-upstream",
        files: { "README.md": "# fork PR upstream\n" },
      },
    );
    pool = new GitGraspPool({
      cloneUrls: [repo.cloneUrl],
      corsProxyBase: null,
    });
    const forkUrl = fixture.serverB.cloneUrl(
      fixture.contributor.npub,
      repo.identifier,
    );
    const defaultObjects = await upstreamObjectsFromPool(pool, repo);
    const fork = await seedForkPR({
      fixture,
      repo,
      forkUrl,
      defaultObjects,
      branch: "fork/pr-only",
    });

    const { result, pushSummary } = await performForkPRMerge({
      fixture,
      repo,
      pool,
      fork,
      currentStateEvent: repo.state,
    });

    expect(pushSummary?.successCount).toBe(1);
    expect(pushSummary?.totalCount).toBe(1);
    const refsA = await getReceivePackRefs(repo.cloneUrl);
    expect(refsA.refs[`refs/heads/${repo.branch}`]).toBe(
      result.mergeCommit.hash,
    );
    const mergeCommit = await pool.getSingleCommit(
      result.mergeCommit.hash,
      new AbortController().signal,
    );
    expect(mergeCommit?.parents[1]).toBe(fork.prSeed.commit);
    await expectForkUnchanged(fork);
  }, 90_000);

  it("combines fork-fetched PR objects with maintainer branch catch-up objects", async () => {
    fixture = await createFixture();
    const seededRepo = await seedRepo(
      fixture.serverA,
      fixture.relayA,
      fixture.maintainer,
      {
        identifier: "fork-pr-state-ahead",
        files: { "README.md": "# state ahead upstream\n" },
      },
    );
    pool = new GitGraspPool({
      cloneUrls: [seededRepo.cloneUrl],
      corsProxyBase: null,
    });
    const initialObjects = await upstreamObjectsFromPool(pool, seededRepo);
    const advanced: AdvanceBranchResult = await advanceBranch(
      seededRepo,
      fixture.maintainer,
      {
        pushTo: [],
        publishStateTo: [fixture.relayA],
        path: "STATE-AHEAD.md",
        content: "state has this commit before upstream git does\n",
      },
    );
    const repo = advanced.repo;
    const forkUrl = fixture.serverB.cloneUrl(
      fixture.contributor.npub,
      repo.identifier,
    );
    const fork = await seedForkPR({
      fixture,
      repo,
      forkUrl,
      defaultObjects: [...initialObjects, ...advanced.objects],
      branch: "fork/pr-plus-catchup",
    });

    const { result, pushSummary } = await performForkPRMerge({
      fixture,
      repo,
      pool,
      fork,
      currentStateEvent: advanced.state,
    });

    expect(pushSummary?.successCount).toBe(1);
    const refsA = await getReceivePackRefs(seededRepo.cloneUrl);
    expect(refsA.refs[`refs/heads/${repo.branch}`]).toBe(
      result.mergeCommit.hash,
    );
    const caughtUpCommit = await pool.getSingleCommit(
      advanced.commit,
      new AbortController().signal,
    );
    expect(caughtUpCommit?.hash).toBe(advanced.commit);
    const mergeCommit = await pool.getSingleCommit(
      result.mergeCommit.hash,
      new AbortController().signal,
    );
    expect(mergeCommit?.parents).toEqual([advanced.commit, fork.prSeed.commit]);
    await expectForkUnchanged(fork);
  }, 90_000);
});
