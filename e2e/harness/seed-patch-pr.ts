/**
 * seed-patch-pr — build a NIP-34 patch-type PR (kind:1617) against a seeded repo.
 *
 * Mirrors what a contributor's `ngit send` produces: a second commit on top of
 * `SeededRepo.headCommit` that changes one file, serialized as a git
 * `format-patch` body and wrapped in a kind:1617 event, then published to the
 * grasp relay.
 *
 * Like `repo-fixture.ts`, this constructs the Nostr event directly with
 * `nostr-tools` (no `@/services/nostr`, no `EventFactory`) and builds the git
 * objects with the app's pure `@/lib/git-*` libraries. The patch event's tag
 * layout intentionally matches what ngit emits and what `src/casts/Patch.ts`
 * and `src/lib/patch-merge.ts` parse:
 *
 *   ["t", "root"]                                  // root patch of the set
 *   ["a", "30617:<pubkey>:<identifier>"]           // repo coordinate
 *   ["r", "<euc-commit-hash>"]                      // earliest-unique-commit
 *   ["commit", "<new-commit-hash>"]
 *   ["parent-commit", "<base-commit-hash>"]
 *   ["commit-pgp-sig", ""]                          // (omitted — unsigned)
 *   ["committer", name, email, ts, tz]
 *   ["author",    name, email, ts, tz]
 *   ["description", "<subject>\n\n<body>"]
 *   ["p", "<maintainer-pubkey>"]
 *
 * The content is the git `format-patch` text (From/Date/Subject headers + the
 * unified diff + a `base-commit:` trailer), so `extractPatchDiff` and the
 * `Patch` cast's content-fallback parsers both work.
 *
 * The crucial invariant for the merge test: the new commit is built with the
 * SAME `@/lib/git-*` primitives the merge code uses to re-derive it, so when
 * `buildPatchChainObjects` applies the diff against the base tree and recomputes
 * the commit hash, it matches `["commit", ...]` exactly (`allHashesVerified`).
 */

import { finalizeEvent, type NostrEvent } from "nostr-tools";
import {
  packBlob,
  packCommit,
  packTree,
  type PackableObject,
} from "@/lib/git-packfile";
import type { CommitPerson, TreeEntry } from "@/lib/git-objects";
import { PATCH_KIND } from "@/lib/nip34";
import type { SeededRepo } from "./repo-fixture";
import type { RelayClient } from "./relay-client";
import type { TestSigner } from "./test-signer";

export interface SeedPatchPROptions {
  /**
   * Path of the file to add/modify in the patch. Default: a new file
   * "FEATURE.md" so we never collide with the seeded README.
   */
  path?: string;
  /** New UTF-8 content for the file. Default: a short feature note. */
  content?: string;
  /**
   * Original content of the file in the base tree, if this patch MODIFIES an
   * existing seeded file rather than adding a new one. When omitted the patch
   * is treated as adding a brand-new file (`/dev/null` → b/<path>).
   */
  baseContent?: string;
  /** Commit subject line. Default: "Add feature note". */
  subject?: string;
  /** Commit body (after a blank line). Default: "". */
  body?: string;
  /** Author/committer display name. Default: "e2e contributor". */
  authorName?: string;
  /** Commit author timestamp (unix seconds). Default: base head + 60s. */
  timestamp?: number;
}

export interface SeededPatchPR {
  /** The signed kind:1617 patch event (published to the grasp relay). */
  patch: NostrEvent;
  /** Hex SHA-1 of the contributor's new commit (the patch tip). */
  commit: string;
  /** Hex SHA-1 of the new commit's root tree. */
  tree: string;
  /** Hex SHA-1 of the changed file's blob. */
  blob: string;
  /** The file path that the patch changes. */
  path: string;
  /** The new file content. */
  content: string;
  /** The base commit the patch applies on top of (= repo.headCommit). */
  parentCommit: string;
}

/** git format-patch person line: `Name <email> <unix-ts> <tz>`. */
function personTag(
  tagName: "author" | "committer",
  person: CommitPerson,
): string[] {
  return [
    tagName,
    person.name,
    person.email,
    String(person.timestamp),
    person.timezone,
  ];
}

/**
 * Build a single-file git unified diff in `format-patch` style.
 *
 * For a new file the header is the standard `new file mode` form; for a
 * modification it's the plain `a/<path>` → `b/<path>` form. We emit one hunk
 * that replaces the whole file, which `parse-diff` + `diff.applyPatch`
 * reconstruct exactly against the recorded base content.
 */
function buildUnifiedDiff(
  path: string,
  baseContent: string | undefined,
  newContent: string,
  newBlobHash: string,
): string {
  const isNew = baseContent === undefined;
  const oldLines = isNew ? [] : baseContent.split("\n");
  const newLines = newContent.split("\n");

  // Drop a single trailing empty element produced by a trailing newline so the
  // hunk counts match git's (git counts content lines, with a "No newline"
  // marker when the trailing newline is absent — both our blobs end in \n).
  const trimTrailing = (lines: string[]): string[] =>
    lines.length > 1 && lines[lines.length - 1] === ""
      ? lines.slice(0, -1)
      : lines;
  const oldBody = trimTrailing(oldLines);
  const newBody = trimTrailing(newLines);

  const oldCount = oldBody.length;
  const newCount = newBody.length;
  const oldStart = oldCount === 0 ? 0 : 1;
  const newStart = newCount === 0 ? 0 : 1;

  let diff = `diff --git a/${path} b/${path}\n`;
  if (isNew) {
    diff += `new file mode 100644\n`;
    diff += `index 0000000000000000000000000000000000000000..${newBlobHash} 100644\n`;
    diff += `--- /dev/null\n`;
  } else {
    diff += `--- a/${path}\n`;
  }
  diff += `+++ b/${path}\n`;
  diff += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
  for (const line of oldBody) diff += `-${line}\n`;
  for (const line of newBody) diff += `+${line}\n`;

  return diff;
}

/**
 * Build a contributor commit on top of `repo.headCommit` (changing one file),
 * produce a kind:1617 patch event for it, publish that event to the grasp
 * relay, and return the patch + the new git object hashes.
 *
 * The patch is authored/published by `contributor`. The repo `maintainer` is
 * referenced via a `p` tag for notification (matching ngit), but does NOT need
 * to be the publisher.
 */
export async function seedPatchPR(
  repo: SeededRepo,
  relay: RelayClient,
  contributor: TestSigner,
  options: SeedPatchPROptions = {},
): Promise<SeededPatchPR> {
  const path = options.path ?? "FEATURE.md";
  const content =
    options.content ?? "# Feature\n\nadded by the e2e contributor\n";
  const baseContent = options.baseContent;
  const subject = options.subject ?? "Add feature note";
  const body = options.body ?? "";
  const authorName = options.authorName ?? "e2e contributor";
  const timestamp = options.timestamp ?? repo.headCommitTimestamp + 60;

  const person: CommitPerson = {
    name: authorName,
    email: `${contributor.npub}@nostr`,
    timestamp,
    timezone: "+0000",
  };

  // --- Build the new git objects with the same primitives the merge uses ---
  const objects: PackableObject[] = [];

  // New blob for the changed file.
  const blob = await packBlob(new TextEncoder().encode(content));
  objects.push(blob);

  // The new root tree = base tree's entries with this file added/replaced.
  // The seeded repo's root tree contains exactly its initial files; we union
  // the changed file in (replacing any existing entry of the same path).
  const baseEntries: TreeEntry[] = Object.entries(repo.blobHashes).map(
    ([name, hash]) => ({ mode: "100644", name, hash }),
  );
  const treeEntries: TreeEntry[] = [
    ...baseEntries.filter((e) => e.name !== path),
    { mode: "100644", name: path, hash: blob.hash },
  ];
  const tree = await packTree(treeEntries);
  objects.push(tree);

  // The new commit, parented on the seeded head.
  const message = body ? `${subject}\n\n${body}` : subject;
  const commit = await packCommit({
    treeHash: tree.hash,
    parentHashes: [repo.headCommit],
    author: person,
    committer: person,
    message,
  });
  objects.push(commit);

  // --- Build the git format-patch content ---
  const diff = buildUnifiedDiff(path, baseContent, content, blob.hash);
  const dateHeader = new Date(timestamp * 1000).toUTCString();
  const patchContent =
    `From ${commit.hash} Mon Sep 17 00:00:00 2001\n` +
    `From: ${person.name} <${person.email}>\n` +
    `Date: ${dateHeader}\n` +
    `Subject: [PATCH] ${subject}\n` +
    (body ? `\n${body}\n` : "") +
    `\n---\n\n` +
    diff +
    `\n-- \n` +
    `2.45.0\n\n` +
    `base-commit: ${repo.headCommit}\n`;

  // --- Build + sign the kind:1617 patch event ---
  const patch = finalizeEvent(
    {
      kind: PATCH_KIND,
      created_at: timestamp,
      content: patchContent,
      tags: [
        ["a", repo.coordinate],
        ["r", repo.headCommit, "euc"],
        ["t", "root"],
        ["commit", commit.hash],
        ["parent-commit", repo.headCommit],
        personTag("committer", person),
        personTag("author", person),
        ["description", body ? `${subject}\n\n${body}` : subject],
        ["p", repo.pubkey],
        ["alt", `git patch: ${subject}`],
      ],
    },
    contributor.secretKey,
  );

  await relay.publish(patch);

  return {
    patch,
    commit: commit.hash,
    tree: tree.hash,
    blob: blob.hash,
    path,
    content,
    parentCommit: repo.headCommit,
  };
}
