/**
 * repo-fixture — seed a NIP-34 repository on a running grasp server.
 *
 * Mirrors the announce → state → push sequence the app performs, using the
 * app's own pure git libraries (`git-objects`, `git-packfile`, `git-push`).
 *
 * The kind:30617 announcement and kind:30618 state events are constructed
 * directly with `nostr-tools` rather than via the app's `EventFactory`
 * subclasses. This is deliberate:
 *
 *   - It keeps the harness fully decoupled from the `@/services/nostr`
 *     singleton graph (pool, eventStore, outboxStore, settings, cache). Those
 *     modules touch browser globals and the production relay network at
 *     module-load time; importing them into a node test harness is both
 *     fragile and a side-effect risk.
 *   - A harness should produce *independently-known-good* fixtures. Tests that
 *     specifically want to validate the factories' output can import them
 *     directly in a jsdom unit test.
 *
 * The event shapes here intentionally match `RepoAnnouncementFactory` and
 * `RepoStateFactory` (see those files in `src/factories/`).
 *
 * Grasp's "purgatory" flow (see ngit-grasp `src/purgatory/`):
 *   1. A kind:30617 announcement is published → grasp creates the bare repo.
 *   2. A kind:30618 state event is published → its refs enter purgatory,
 *      authorizing a push for those refs for ~30 minutes.
 *   3. The packfile is pushed via git-receive-pack → grasp accepts the refs
 *      that match purgatory.
 */

import { finalizeEvent, nip19, type NostrEvent } from "nostr-tools";
import {
  packBlob,
  packCommit,
  packTree,
  createPackfile,
  type PackableObject,
} from "@/lib/git-packfile";
import { pushToGitServer, ZERO_HASH } from "@/lib/git-push";
import type { CommitPerson } from "@/lib/git-objects";
import type { GraspServer } from "./grasp-server";
import type { RelayClient } from "./relay-client";
import type { TestSigner } from "./test-signer";

/** NIP-34 repository announcement. */
export const REPO_KIND = 30617;
/** NIP-34 repository state. */
export const REPO_STATE_KIND = 30618;

export interface SeedRepoOptions {
  /** d-tag / repo slug. Default: "test-repo". */
  identifier?: string;
  /** Human-readable name. Default: identifier. */
  name?: string;
  /** Description. Default: "". */
  description?: string;
  /** Default branch name. Default: "main". */
  branch?: string;
  /** Files for the initial commit, path → UTF-8 content. Default: a README. */
  files?: Record<string, string>;
  /** Commit message for the initial commit. Default: "initial commit". */
  message?: string;
}

export interface SeededRepo {
  /** d-tag of the repo. */
  identifier: string;
  /** Default branch name. */
  branch: string;
  /** npub of the owner. */
  npub: string;
  /** Hex pubkey of the owner. */
  pubkey: string;
  /** The clone URL on the grasp server. */
  cloneUrl: string;
  /** Repo coordinate "30617:<pubkey>:<identifier>". */
  coordinate: string;
  /** The signed kind:30617 announcement. */
  announcement: NostrEvent;
  /** The signed kind:30618 state event. */
  state: NostrEvent;
  /** Hex SHA-1 of the root commit now at refs/heads/<branch>. */
  headCommit: string;
  /** Hex SHA-1 of the root tree. */
  rootTree: string;
  /** Map of file path → blob hash for the seeded files. */
  blobHashes: Record<string, string>;
}

const DEFAULT_FILES: Record<string, string> = {
  "README.md": "# test repo\n\nseeded by the e2e harness\n",
};

/** Build a CommitPerson for `signer` at the given unix-second timestamp. */
function commitPerson(signer: TestSigner, timestamp: number): CommitPerson {
  return {
    name: "e2e test",
    email: `${signer.npub}@nostr`,
    timestamp,
    timezone: "+0000",
  };
}

/**
 * Build a signed kind:30617 repo announcement. Matches the tag layout produced
 * by `RepoAnnouncementFactory`.
 */
export function buildAnnouncement(
  signer: TestSigner,
  params: {
    identifier: string;
    name: string;
    description: string;
    cloneUrls: string[];
    relayUrls: string[];
    eucCommitHash: string;
  },
): NostrEvent {
  return finalizeEvent(
    {
      kind: REPO_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [
        ["d", params.identifier],
        ["name", params.name],
        ["description", params.description],
        ["clone", ...params.cloneUrls],
        ["relays", ...params.relayUrls],
        ["r", params.eucCommitHash, "euc"],
        ["alt", `git repository: ${params.name}`],
      ],
    },
    signer.secretKey,
  );
}

/**
 * Build a signed kind:30618 repo state event. Matches the tag layout produced
 * by `RepoStateFactory`.
 */
export function buildState(
  signer: TestSigner,
  params: { identifier: string; commitHash: string; branch: string },
): NostrEvent {
  return finalizeEvent(
    {
      kind: REPO_STATE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [
        ["d", params.identifier],
        [`refs/heads/${params.branch}`, params.commitHash],
        ["HEAD", `ref: refs/heads/${params.branch}`],
      ],
    },
    signer.secretKey,
  );
}

/**
 * Seed a fresh repo on `grasp`, owned by `signer`, and return its descriptor.
 *
 * @param grasp  the running grasp server
 * @param relay  an open RelayClient connected to grasp.relayUrl
 * @param signer the repo owner / maintainer
 */
export async function seedRepo(
  grasp: GraspServer,
  relay: RelayClient,
  signer: TestSigner,
  options: SeedRepoOptions = {},
): Promise<SeededRepo> {
  const identifier = options.identifier ?? "test-repo";
  const name = options.name ?? identifier;
  const description = options.description ?? "";
  const branch = options.branch ?? "main";
  const files = options.files ?? DEFAULT_FILES;
  const message = options.message ?? "initial commit";

  const npub = signer.npub;
  const cloneUrl = grasp.cloneUrl(npub, identifier);
  const relayUrl = grasp.relayUrl;

  // --- Build the initial commit objects ---
  const timestamp = Math.floor(Date.now() / 1000);
  const person = commitPerson(signer, timestamp);

  const objects: PackableObject[] = [];
  const blobHashes: Record<string, string> = {};
  const treeEntries: { mode: string; name: string; hash: string }[] = [];

  for (const [path, content] of Object.entries(files)) {
    const blob = await packBlob(new TextEncoder().encode(content));
    objects.push(blob);
    blobHashes[path] = blob.hash;
    treeEntries.push({ mode: "100644", name: path, hash: blob.hash });
  }

  const tree = await packTree(treeEntries);
  objects.push(tree);

  const commit = await packCommit({
    treeHash: tree.hash,
    parentHashes: [],
    author: person,
    committer: person,
    message,
  });
  objects.push(commit);

  // --- 1. Publish the announcement (grasp creates the bare repo) ---
  const announcement = buildAnnouncement(signer, {
    identifier,
    name,
    description,
    cloneUrls: [cloneUrl],
    relayUrls: [relayUrl],
    eucCommitHash: commit.hash,
  });
  await relay.publish(announcement);

  // --- 2. Publish the state event (refs enter purgatory → push authorized) ---
  const state = buildState(signer, {
    identifier,
    commitHash: commit.hash,
    branch,
  });
  await relay.publish(state);

  // --- 3. Push the packfile ---
  const packfile = await createPackfile(objects);
  const result = await pushToGitServer(
    cloneUrl,
    [
      {
        oldHash: ZERO_HASH,
        newHash: commit.hash,
        refName: `refs/heads/${branch}`,
      },
    ],
    packfile,
  );

  if (!result.unpackOk || !result.refResults.every((r) => r.ok)) {
    throw new Error(
      `seedRepo: initial push failed (unpackOk=${result.unpackOk}): ` +
        result.refResults
          .map((r) => `${r.refName}=${r.ok ? "ok" : r.reason}`)
          .join(", "),
    );
  }

  return {
    identifier,
    branch,
    npub,
    pubkey: signer.pubkey,
    cloneUrl,
    coordinate: `${REPO_KIND}:${signer.pubkey}:${identifier}`,
    announcement,
    state,
    headCommit: commit.hash,
    rootTree: tree.hash,
    blobHashes,
  };
}

/** Decode an npub back to hex (convenience for assertions). */
export function npubToHex(npub: string): string {
  const decoded = nip19.decode(npub);
  if (decoded.type !== "npub") throw new Error(`not an npub: ${npub}`);
  return decoded.data;
}
