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
import { pushToGitServer, ZERO_HASH, type RefUpdate } from "@/lib/git-push";
import type { CommitPerson, TreeEntry } from "@/lib/git-objects";
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
  /** Every announced clone URL for this repository. */
  cloneUrls: string[];
  /** Every announced grasp relay URL for this repository. */
  relayUrls: string[];
  /** Repo coordinate "30617:<pubkey>:<identifier>". */
  coordinate: string;
  /** The signed kind:30617 announcement. */
  announcement: NostrEvent;
  /** The signed kind:30618 state event. */
  state: NostrEvent;
  /** Hex SHA-1 of the root commit now at refs/heads/<branch>. */
  headCommit: string;
  /** Unix-second timestamp used for the root commit's author/committer. */
  headCommitTimestamp: number;
  /** Hex SHA-1 of the root tree. */
  rootTree: string;
  /** Map of file path → blob hash for the seeded files. */
  blobHashes: Record<string, string>;
}

export interface SeededRepoServer {
  server: GraspServer;
  relay: RelayClient;
  cloneUrl: string;
  relayUrl: string;
}

export interface SeededMultiServerRepo extends SeededRepo {
  /** The grasp servers this fixture was seeded onto, in caller-supplied order. */
  servers: SeededRepoServer[];
}

export interface AdvanceBranchOptions {
  /** Servers to receive the git ref update. Default: none. */
  pushTo?: GraspServer[];
  /** Relays to receive the replacement kind:30618 state. Default: none. */
  publishStateTo?: RelayClient[];
  /** File path to add/replace in the follow-up commit. */
  path?: string;
  /** UTF-8 content for `path`. */
  content?: string;
  /** Commit message. */
  message?: string;
  /** Commit author/committer timestamp. Default: previous head + 60s. */
  timestamp?: number;
}

export interface AdvanceBranchResult {
  /** Repo descriptor updated to the newly signed state/head. */
  repo: SeededRepo;
  /** Previous head before the advance. */
  previousHead: string;
  /** New branch head commit hash. */
  commit: string;
  /** New root tree hash. */
  tree: string;
  /** Signed replacement kind:30618. */
  state: NostrEvent;
  /** Git objects for the follow-up commit. */
  objects: PackableObject[];
  /** Clone URLs that were pushed. */
  pushedCloneUrls: string[];
  /** Relay URLs that received the state event. */
  publishedRelayUrls: string[];
}

export interface SeedTagOptions {
  /** Tag name, with or without the refs/tags/ prefix. */
  name: string;
  /** Commit/object hash the tag should point at. Default: repo.headCommit. */
  commit?: string;
  /** Servers to receive the tag ref update. Default: none. */
  pushTo?: GraspServer[];
  /** Relays whose state event should include the tag. Default: none. */
  includeInStateTo?: RelayClient[];
  /** Objects to pack with the tag ref update. Default: empty pack. */
  objects?: PackableObject[];
}

export interface SeedTagResult {
  /** Repo descriptor updated to the tag-preserving state. */
  repo: SeededRepo;
  /** Full ref name for the tag. */
  refName: string;
  /** Hash the tag points at. */
  commit: string;
  /** Signed replacement kind:30618. */
  state: NostrEvent;
  /** Clone URLs that received the tag ref. */
  pushedCloneUrls: string[];
  /** Relay URLs that received the state event. */
  publishedRelayUrls: string[];
}

const DEFAULT_FILES: Record<string, string> = {
  "README.md": "# test repo\n\nseeded by the e2e harness\n",
};

export async function waitUntilAfterUnixSecond(
  timestamp: number,
): Promise<void> {
  while (Math.floor(Date.now() / 1000) <= timestamp) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Build a CommitPerson for `signer` at the given unix-second timestamp. */
function commitPerson(signer: TestSigner, timestamp: number): CommitPerson {
  return {
    name: "e2e test",
    email: `${signer.npub}@nostr`,
    timestamp,
    timezone: "+0000",
  };
}

async function buildCommitFromFiles(params: {
  signer: TestSigner;
  files: Record<string, string>;
  parentHashes: string[];
  message: string;
  timestamp: number;
}): Promise<{
  objects: PackableObject[];
  commit: PackableObject;
  tree: PackableObject;
  blobHashes: Record<string, string>;
}> {
  const person = commitPerson(params.signer, params.timestamp);
  const objects: PackableObject[] = [];
  const blobHashes: Record<string, string> = {};
  const treeEntries: TreeEntry[] = [];

  for (const [path, content] of Object.entries(params.files).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const blob = await packBlob(new TextEncoder().encode(content));
    objects.push(blob);
    blobHashes[path] = blob.hash;
    treeEntries.push({ mode: "100644", name: path, hash: blob.hash });
  }

  const tree = await packTree(treeEntries);
  objects.push(tree);

  const commit = await packCommit({
    treeHash: tree.hash,
    parentHashes: params.parentHashes,
    author: person,
    committer: person,
    message: params.message,
  });
  objects.push(commit);

  return { objects, commit, tree, blobHashes };
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
  return buildStateWithRefs(signer, {
    identifier: params.identifier,
    refs: [
      { name: `refs/heads/${params.branch}`, commitHash: params.commitHash },
    ],
    headBranch: params.branch,
  });
}

/** Build a signed kind:30618 from an explicit ref set. */
export function buildStateWithRefs(
  signer: TestSigner,
  params: {
    identifier: string;
    refs: { name: string; commitHash: string }[];
    headBranch: string;
  },
): NostrEvent {
  const refs = new Map<string, string>();
  for (const ref of params.refs) refs.set(ref.name, ref.commitHash);

  return finalizeEvent(
    {
      kind: REPO_STATE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [
        ["d", params.identifier],
        ...[...refs].map(([name, commitHash]) => [name, commitHash]),
        ["HEAD", `ref: refs/heads/${params.headBranch}`],
      ],
    },
    signer.secretKey,
  );
}

function stateRefMap(state: NostrEvent): Map<string, string> {
  const refs = new Map<string, string>();
  for (const [name, commitHash] of state.tags) {
    if (name?.startsWith("refs/") && !name.endsWith("^{}") && commitHash) {
      refs.set(name, commitHash);
    }
  }
  return refs;
}

function repoWithState(
  repo: SeededRepo,
  state: NostrEvent,
  updates: Partial<SeededRepo>,
): SeededRepo {
  return { ...repo, ...updates, state };
}

function assertRepoSigner(repo: SeededRepo, signer: TestSigner): void {
  if (repo.pubkey !== signer.pubkey) {
    throw new Error(
      `fixture signer ${signer.pubkey} does not own repo ${repo.coordinate}`,
    );
  }
}

async function publishStateToRelays(
  state: NostrEvent,
  relays: RelayClient[],
): Promise<string[]> {
  await Promise.all(relays.map((relay) => relay.publish(state)));
  return relays.map((relay) => relay.url);
}

async function pushRefToServers(params: {
  repo: SeededRepo;
  servers: GraspServer[];
  refUpdate: RefUpdate;
  objects: PackableObject[];
  label: string;
}): Promise<string[]> {
  const packfile = await createPackfile(params.objects);
  const cloneUrls = params.servers.map((server) =>
    server.cloneUrl(params.repo.npub, params.repo.identifier),
  );

  await Promise.all(
    cloneUrls.map(async (cloneUrl) => {
      const result = await pushToGitServer(
        cloneUrl,
        [params.refUpdate],
        packfile,
      );
      if (!result.unpackOk || !result.refResults.every((r) => r.ok)) {
        throw new Error(
          `${params.label}: push to ${cloneUrl} failed ` +
            `(unpackOk=${result.unpackOk}): ` +
            result.refResults
              .map((r) => `${r.refName}=${r.ok ? "ok" : r.reason}`)
              .join(", "),
        );
      }
    }),
  );

  return cloneUrls;
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
  const repo = await seedMultiServerRepo([grasp], [relay], signer, options);
  const { servers: _servers, ...seeded } = repo;
  void _servers;
  return seeded;
}

/**
 * Seed the same NIP-34 repository on multiple Grasp servers.
 *
 * The announcement lists every clone URL and relay URL, and is published to
 * every server's relay so each Grasp instance creates its bare repo. The state
 * is also published to every relay before the initial packfile is pushed to
 * each server individually.
 */
export async function seedMultiServerRepo(
  grasps: GraspServer[],
  relays: RelayClient[],
  signer: TestSigner,
  options: SeedRepoOptions = {},
): Promise<SeededMultiServerRepo> {
  if (grasps.length === 0) throw new Error("seedMultiServerRepo: no servers");
  if (grasps.length !== relays.length) {
    throw new Error("seedMultiServerRepo: servers and relays must align");
  }

  const identifier = options.identifier ?? "test-repo";
  const name = options.name ?? identifier;
  const description = options.description ?? "";
  const branch = options.branch ?? "main";
  const files = options.files ?? DEFAULT_FILES;
  const message = options.message ?? "initial commit";

  const npub = signer.npub;
  const cloneUrls = grasps.map((grasp) => grasp.cloneUrl(npub, identifier));
  const relayUrls = grasps.map((grasp) => grasp.relayUrl);
  const cloneUrl = cloneUrls[0];

  // --- Build the initial commit objects ---
  const timestamp = Math.floor(Date.now() / 1000);
  const { objects, commit, tree, blobHashes } = await buildCommitFromFiles({
    signer,
    files,
    parentHashes: [],
    message,
    timestamp,
  });

  // --- 1. Publish the announcement (each grasp creates the bare repo) ---
  const announcement = buildAnnouncement(signer, {
    identifier,
    name,
    description,
    cloneUrls,
    relayUrls,
    eucCommitHash: commit.hash,
  });
  await Promise.all(relays.map((relay) => relay.publish(announcement)));

  // --- 2. Publish the state event (refs enter purgatory → push authorized) ---
  const state = buildState(signer, {
    identifier,
    commitHash: commit.hash,
    branch,
  });
  await Promise.all(relays.map((relay) => relay.publish(state)));
  // NIP-34 state is addressable/replaceable (pubkey + kind + d). Grasp relays
  // break same-second replacement ties by event id, so a fixture that publishes
  // a follow-up state immediately after seeding can randomly lose the newer
  // state. Tick past the seeded state's second before returning the fixture.
  await waitUntilAfterUnixSecond(state.created_at);

  // --- 3. Push the packfile to every server ---
  const packfile = await createPackfile(objects);
  const refUpdate: RefUpdate = {
    oldHash: ZERO_HASH,
    newHash: commit.hash,
    refName: `refs/heads/${branch}`,
  };
  const pushResults = await Promise.all(
    cloneUrls.map((url) => pushToGitServer(url, [refUpdate], packfile)),
  );

  for (const [index, result] of pushResults.entries()) {
    if (!result.unpackOk || !result.refResults.every((r) => r.ok)) {
      throw new Error(
        `seedMultiServerRepo: initial push to ${cloneUrls[index]} failed ` +
          `(unpackOk=${result.unpackOk}): ` +
          result.refResults
            .map((r) => `${r.refName}=${r.ok ? "ok" : r.reason}`)
            .join(", "),
      );
    }
  }

  return {
    identifier,
    branch,
    npub,
    pubkey: signer.pubkey,
    cloneUrl,
    cloneUrls,
    relayUrls,
    coordinate: `${REPO_KIND}:${signer.pubkey}:${identifier}`,
    announcement,
    state,
    headCommit: commit.hash,
    headCommitTimestamp: timestamp,
    rootTree: tree.hash,
    blobHashes,
    servers: grasps.map((server, index) => ({
      server,
      relay: relays[index],
      cloneUrl: cloneUrls[index],
      relayUrl: relayUrls[index],
    })),
  };
}

/**
 * Build a follow-up commit, publish the replacement state to selected relays,
 * and push the branch update to selected servers.
 */
export async function advanceBranch(
  repo: SeededRepo,
  signer: TestSigner,
  options: AdvanceBranchOptions = {},
): Promise<AdvanceBranchResult> {
  assertRepoSigner(repo, signer);

  const path = options.path ?? `advance-${repo.headCommit.slice(0, 8)}.md`;
  const content = options.content ?? `advanced ${repo.identifier}\n`;
  const files = { ...repo.blobHashes };
  const blob = await packBlob(new TextEncoder().encode(content));
  files[path] = blob.hash;

  const treeEntries: TreeEntry[] = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, hash]) => ({ mode: "100644", name, hash }));
  const tree = await packTree(treeEntries);
  const timestamp =
    options.timestamp ??
    Math.max(Math.floor(Date.now() / 1000), repo.headCommitTimestamp + 60);
  const person = commitPerson(signer, timestamp);
  const commit = await packCommit({
    treeHash: tree.hash,
    parentHashes: [repo.headCommit],
    author: person,
    committer: person,
    message: options.message ?? `advance ${repo.branch}`,
  });
  const objects = [blob, tree, commit];

  const refs = stateRefMap(repo.state);
  refs.set(`refs/heads/${repo.branch}`, commit.hash);
  const state = buildStateWithRefs(signer, {
    identifier: repo.identifier,
    refs: [...refs].map(([name, commitHash]) => ({ name, commitHash })),
    headBranch: repo.branch,
  });

  const publishedRelayUrls = await publishStateToRelays(
    state,
    options.publishStateTo ?? [],
  );
  if (publishedRelayUrls.length > 0) {
    await waitUntilAfterUnixSecond(state.created_at);
  }

  const refUpdate: RefUpdate = {
    oldHash: repo.headCommit,
    newHash: commit.hash,
    refName: `refs/heads/${repo.branch}`,
  };
  const pushedCloneUrls = await pushRefToServers({
    repo,
    servers: options.pushTo ?? [],
    refUpdate,
    objects,
    label: "advanceBranch",
  });

  return {
    repo: repoWithState(repo, state, {
      headCommit: commit.hash,
      headCommitTimestamp: timestamp,
      rootTree: tree.hash,
      blobHashes: files,
    }),
    previousHead: repo.headCommit,
    commit: commit.hash,
    tree: tree.hash,
    state,
    objects,
    pushedCloneUrls,
    publishedRelayUrls,
  };
}

/** Add a tag ref to selected relays/servers for lagging-state fixtures. */
export async function seedTag(
  repo: SeededRepo,
  signer: TestSigner,
  options: SeedTagOptions,
): Promise<SeedTagResult> {
  assertRepoSigner(repo, signer);

  const refName = options.name.startsWith("refs/tags/")
    ? options.name
    : `refs/tags/${options.name}`;
  const commit = options.commit ?? repo.headCommit;
  const refs = stateRefMap(repo.state);
  refs.set(refName, commit);
  const state = buildStateWithRefs(signer, {
    identifier: repo.identifier,
    refs: [...refs].map(([name, commitHash]) => ({ name, commitHash })),
    headBranch: repo.branch,
  });

  const publishedRelayUrls = await publishStateToRelays(
    state,
    options.includeInStateTo ?? [],
  );
  if (publishedRelayUrls.length > 0) {
    await waitUntilAfterUnixSecond(state.created_at);
  }

  const pushedCloneUrls = await pushRefToServers({
    repo,
    servers: options.pushTo ?? [],
    refUpdate: { oldHash: ZERO_HASH, newHash: commit, refName },
    objects: options.objects ?? [],
    label: "seedTag",
  });

  return {
    repo: repoWithState(repo, state, {}),
    refName,
    commit,
    state,
    pushedCloneUrls,
    publishedRelayUrls,
  };
}

/** Decode an npub back to hex (convenience for assertions). */
export function npubToHex(npub: string): string {
  const decoded = nip19.decode(npub);
  if (decoded.type !== "npub") throw new Error(`not an npub: ${npub}`);
  return decoded.data;
}
