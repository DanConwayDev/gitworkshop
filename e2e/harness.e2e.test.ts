/**
 * Harness smoke test.
 *
 * Validates the harness foundation end to end, in escalating steps:
 *
 *   1. GraspServer.start() — the binary is found, spawns, and serves HTTP.
 *   2. NIP-11 — the relay surface answers an HTTP info request.
 *   3. RelayClient — connect, publish an event, read it back via REQ.
 *   4. seedRepo() — announce → state → push lands a real commit on the
 *      grasp git server, and the announcement is queryable from the relay.
 *   5. multi-server helpers — seed two mirrors, advance one, and publish a
 *      tag to one side so future merge suites can assert lagging fixtures.
 *
 * When it passes, the harness is known-good and real feature tests (e.g. the
 * Merge button) can build on `seedRepo`. The whole suite skips cleanly if no
 * ngit-grasp binary is available.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { finalizeEvent } from "nostr-tools";
import {
  GraspServer,
  RelayClient,
  TestSigner,
  advanceBranch,
  seedRepo,
  seedMultiServerRepo,
  seedTag,
  graspBinaryAvailable,
  REPO_KIND,
  REPO_STATE_KIND,
} from "./harness";
import { getReceivePackRefs } from "@/lib/git-push";

// Skip the entire suite (cleanly) when there's no ngit-grasp binary.
const describeIfGrasp = graspBinaryAvailable() ? describe : describe.skip;

describeIfGrasp("e2e harness — smoke test", () => {
  let server: GraspServer;
  let relay: RelayClient;

  beforeAll(async () => {
    server = await GraspServer.start({ role: "harness" });
    relay = await RelayClient.connect(server.relayUrl);
  });

  afterAll(async () => {
    relay?.close();
    await server?.stop();
  });

  it("step 1: grasp server starts and serves HTTP", async () => {
    const res = await fetch(server.httpUrl + "/");
    expect(res.status).toBe(200);
  });

  it("step 2: relay answers NIP-11", async () => {
    const res = await fetch(server.httpUrl + "/", {
      headers: { Accept: "application/nostr+json" },
    });
    expect(res.status).toBe(200);
    const info = await res.json();
    expect(info).toHaveProperty("supported_nips");
    expect(Array.isArray(info.supported_nips)).toBe(true);
  });

  it("step 3: grasp rejects events unrelated to any repository", async () => {
    // ngit-grasp is a git relay, not a general-purpose one: it only accepts
    // events that reference an accepted repository (or an accepted event).
    // An arbitrary kind:1 note is therefore rejected — documenting this here
    // makes the contract explicit for repo-scoped tests below.
    const signer = new TestSigner();
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "hello from the e2e harness",
      },
      signer.secretKey,
    );

    await expect(relay.publish(event)).rejects.toThrow(/rejected/i);
  });

  it("step 4: seedRepo announces, pushes, and the commit lands on the git server", async () => {
    const maintainer = new TestSigner();
    const repo = await seedRepo(server, relay, maintainer, {
      identifier: "harness-smoke",
      name: "Harness Smoke",
      files: { "README.md": "# harness smoke\n" },
    });

    // The announcement is queryable from the relay.
    const announcements = await relay.query([
      {
        kinds: [REPO_KIND],
        authors: [maintainer.pubkey],
        "#d": ["harness-smoke"],
      },
    ]);
    expect(announcements.map((e) => e.id)).toContain(repo.announcement.id);

    // The state event is queryable from the relay.
    const states = await relay.query([
      {
        kinds: [REPO_STATE_KIND],
        authors: [maintainer.pubkey],
        "#d": ["harness-smoke"],
      },
    ]);
    expect(states.length).toBeGreaterThan(0);

    // The pushed ref is visible on the git server's receive-pack advertisement.
    const refs = await getReceivePackRefs(repo.cloneUrl);
    expect(refs.refs[`refs/heads/${repo.branch}`]).toBe(repo.headCommit);
  });

  it("step 5: multi-server fixtures can manufacture a lagging mirror and state-only tag", async () => {
    const serverB = await GraspServer.start({ role: "harness-b" });
    const relayB = await RelayClient.connect(serverB.relayUrl);

    try {
      const maintainer = new TestSigner();
      const repo = await seedMultiServerRepo(
        [server, serverB],
        [relay, relayB],
        maintainer,
        {
          identifier: "harness-multi-smoke",
          name: "Harness Multi Smoke",
          files: { "README.md": "# harness multi smoke\n" },
        },
      );

      expect(repo.cloneUrls).toEqual([
        server.cloneUrl(maintainer.npub, repo.identifier),
        serverB.cloneUrl(maintainer.npub, repo.identifier),
      ]);

      const advanced = await advanceBranch(repo, maintainer, {
        pushTo: [server],
        publishStateTo: [relay],
        path: "A_ONLY.md",
        content: "server A advanced\n",
        message: "advance only server A",
      });

      const refsAAfterAdvance = await getReceivePackRefs(repo.cloneUrls[0]);
      const refsBAfterAdvance = await getReceivePackRefs(repo.cloneUrls[1]);
      expect(refsAAfterAdvance.refs[`refs/heads/${repo.branch}`]).toBe(
        advanced.commit,
      );
      expect(refsBAfterAdvance.refs[`refs/heads/${repo.branch}`]).toBe(
        repo.headCommit,
      );

      const tagged = await seedTag(advanced.repo, maintainer, {
        name: "v0.1.0",
        includeInStateTo: [relay],
      });

      const statesA = await relay.query([
        {
          kinds: [REPO_STATE_KIND],
          authors: [maintainer.pubkey],
          "#d": [repo.identifier],
        },
      ]);
      const statesB = await relayB.query([
        {
          kinds: [REPO_STATE_KIND],
          authors: [maintainer.pubkey],
          "#d": [repo.identifier],
        },
      ]);
      const taggedStateA = statesA.find(
        (event) => event.id === tagged.state.id,
      );
      expect(taggedStateA?.tags).toContainEqual([
        tagged.refName,
        advanced.commit,
      ]);
      expect(statesB.map((event) => event.id)).not.toContain(tagged.state.id);
    } finally {
      relayB.close();
      await serverB.stop();
    }
  });
});
