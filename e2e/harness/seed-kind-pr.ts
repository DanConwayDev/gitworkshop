/**
 * seed-kind-pr — build a branch-backed NIP-34 PR (kind:1618) for e2e tests.
 *
 * Like the rest of the harness, this constructs events directly with
 * `nostr-tools` and pushes git objects through the pure git helpers. The PR
 * event's `clone` tag can be overridden so fork fixtures can advertise a clone
 * URL that differs from the target repository's announced Grasp URLs.
 */

import { finalizeEvent, type NostrEvent } from "nostr-tools";
import {
  createPackfile,
  packBlob,
  packCommit,
  packTree,
} from "@/lib/git-packfile";
import { pushToGitServer, ZERO_HASH } from "@/lib/git-push";
import type { CommitPerson, TreeEntry } from "@/lib/git-objects";
import { PR_KIND } from "@/lib/nip34";
import {
  buildStateWithRefs,
  waitUntilAfterUnixSecond,
  type SeededRepo,
} from "./repo-fixture";
import type { RelayClient } from "./relay-client";
import type { TestSigner } from "./test-signer";

export interface SeedKindPROptions {
  branch: string;
  path: string;
  content: string;
  subject: string;
  body?: string;
  /** Override the PR event's clone tag. Default: repo.cloneUrl. */
  cloneUrl?: string;
  /** Override where the branch objects are pushed. Default: repo.cloneUrl. */
  pushCloneUrl?: string;
  /**
   * Whether to publish a maintainer-signed repo state containing the PR branch.
   * Default: true. Fork fixtures should set this to false because the branch
   * exists only in the contributor's fork, not the maintainer repository state.
   */
  publishState?: boolean;
  /** Relays to receive the maintainer state. Default: the `relay` argument. */
  publishStateTo?: RelayClient[];
  /** Signer for the branch state. Default: `maintainer`. */
  stateSigner?: TestSigner;
}

export interface SeededKindPR {
  pr: NostrEvent;
  commit: string;
  state: NostrEvent | null;
  branch: string;
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

export async function seedKindPR(
  repo: SeededRepo,
  relay: RelayClient,
  maintainer: TestSigner,
  contributor: TestSigner,
  options: SeedKindPROptions,
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
  const refs = stateRefMap(repo.state);
  refs.set(`refs/heads/${repo.branch}`, repo.headCommit);
  refs.set(prBranchRef, commit.hash);
  const state = buildStateWithRefs(options.stateSigner ?? maintainer, {
    identifier: repo.identifier,
    refs: [...refs].map(([name, commitHash]) => ({ name, commitHash })),
    headBranch: repo.branch,
  });

  if (options.publishState !== false) {
    const stateRelays = options.publishStateTo ?? [relay];
    await Promise.all(
      stateRelays.map((stateRelay) => stateRelay.publish(state)),
    );
  }

  const packfile = await createPackfile([blob, tree, commit]);
  const pushResult = await pushToGitServer(
    options.pushCloneUrl ?? repo.cloneUrl,
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
  if (options.publishState !== false) {
    await waitUntilAfterUnixSecond(state.created_at);
  }

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
        ["clone", options.cloneUrl ?? repo.cloneUrl],
        ["p", repo.pubkey],
        ["alt", `git pull request: ${options.subject}`],
      ],
    },
    contributor.secretKey,
  );
  await relay.publish(pr);

  return {
    pr,
    commit: commit.hash,
    state: options.publishState === false ? null : state,
    branch: options.branch,
  };
}
