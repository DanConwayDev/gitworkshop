/**
 * hello-world e2e smoke test.
 *
 * Validates the harness foundation end to end, in escalating steps:
 *
 *   1. GraspServer.start() — the binary is found, spawns, and serves HTTP.
 *   2. NIP-11 — the relay surface answers an HTTP info request.
 *   3. RelayClient — connect, publish an event, read it back via REQ.
 *   4. seedRepo() — announce → state → push lands a real commit on the
 *      grasp git server, and the announcement is queryable from the relay.
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
  seedRepo,
  graspBinaryAvailable,
  REPO_KIND,
  REPO_STATE_KIND,
} from "./harness";
import { getReceivePackRefs } from "@/lib/git-push";

// Skip the entire suite (cleanly) when there's no ngit-grasp binary.
const describeIfGrasp = graspBinaryAvailable() ? describe : describe.skip;

describeIfGrasp("e2e harness — hello world", () => {
  let server: GraspServer;
  let relay: RelayClient;

  beforeAll(async () => {
    server = await GraspServer.start({ role: "hello" });
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
      identifier: "hello-world",
      name: "Hello World",
      files: { "README.md": "# hello world\n" },
    });

    // The announcement is queryable from the relay.
    const announcements = await relay.query([
      {
        kinds: [REPO_KIND],
        authors: [maintainer.pubkey],
        "#d": ["hello-world"],
      },
    ]);
    expect(announcements.map((e) => e.id)).toContain(repo.announcement.id);

    // The state event is queryable from the relay.
    const states = await relay.query([
      {
        kinds: [REPO_STATE_KIND],
        authors: [maintainer.pubkey],
        "#d": ["hello-world"],
      },
    ]);
    expect(states.length).toBeGreaterThan(0);

    // The pushed ref is visible on the git server's receive-pack advertisement.
    const refs = await getReceivePackRefs(repo.cloneUrl);
    expect(refs.refs[`refs/heads/${repo.branch}`]).toBe(repo.headCommit);
  });
});
