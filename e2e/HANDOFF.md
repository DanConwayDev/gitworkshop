# Merge-button e2e — handoff

## Status

- **Step 1 (re-validate harness): DONE.** `NGIT_GRASP_BIN=… pnpm test:e2e` →
  all 4 hello-world steps pass. `NGIT_GRASP_BIN=/nonexistent pnpm test:e2e` →
  skips cleanly (4 skipped, 0 failures). `npx vitest list` (default config) →
  zero e2e files. No harness changes were needed.
- **Step 2 (seedPatchPR): DONE.** `e2e/harness/seed-patch-pr.ts` builds a 2nd
  commit on top of `repo.headCommit`, emits a kind:1617 patch event with raw
  `nostr-tools` (tags mirror ngit: `commit`, `parent-commit`, `author`,
  `committer`, `description`, `["t","root"]`, `a`, `r`), publishes it to the
  grasp relay, and returns the new commit/tree/blob hashes. Exported from
  `e2e/harness/index.ts`. `SeededRepo` gained `headCommitTimestamp`.
- **Step 3a (extract performMerge): DONE.** `src/lib/perform-merge.ts` is the
  plain-module extraction of `MergePanel.handleMerge` (merge strategy). It takes
  the pre-built chain objects + injected transports (`publishStateToGrasp`,
  `pushObjects`, `publishStatusBroadly`, `broadcastStateBroadly`, `onEvent`,
  `onStep`) and runs: build merge commit → publish kind:30618 → push packfile →
  publish kind:1631 → broadcast state. `MergePanel.tsx` now calls it; behaviour
  is identical (pre-commit-validated). `handlePRMerge` / `handleApplyToTip` were
  left as-is (not extracted).
- **Side-effect decoupling: DONE.** `src/factories/hints.ts` no longer imports
  `@/services/nostr` at module scope (that pulled `window.nostrdb.js` →
  `window is not defined` in node, and would connect to production relays).
  It now uses a lazily-registered `setHintEventStore(eventStore)`, called once
  from `services/nostr.ts`. Contexts that never register a store (the e2e
  harness) get `undefined` hints — the documented fallback — so production
  behaviour is unchanged.
- **Step 3b (merge.e2e.test.ts): DONE — ENABLED AND PASSING.** The test is
  complete end-to-end (`e2e/merge.e2e.test.ts`) and now runs whenever the
  ngit-grasp binary is available (it skips cleanly otherwise). With the
  indexedDB-in-node fix (below) the full merge path is green:
  `NGIT_GRASP_BIN=… pnpm test:e2e` → 6 passed (merge + file-explorer +
  4 hello-world).

  It proves, against a live grasp server:
  - The contributor's kind:1617 patch commit hash re-derives and verifies
    (`allHashesVerified`).
  - A **kind:30618 state event signed by the maintainer — the same npub that
    published the original kind:30617 announcement** — names the merge commit
    as the branch tip.
  - The packfile push is **accepted into purgatory**: grasp's `git-receive-pack`
    only accepts a ref update matching a purgatory entry from a valid state
    event, and `getReceivePackRefs()[refs/heads/main]` equals the merge commit,
    so a successful push is direct evidence of purgatory acceptance.
  - The kind:1631 merged status (with the `merge-commit` tag) is queryable.

  **Remaining gap (negative test, not yet written):** the suite proves the
  maintainer's state+push is _accepted_; it does not yet prove grasp _rejects_
  the same state/push from a non-maintainer npub. That's the natural next test.

## The blocker — RESOLVED

`buildPatchChainObjects([patchCast], pool, …)` returned
`{ reason: "Could not fetch base commit <8hex> from git server" }` because
`pool.getFullTree(baseCommitId)` returned `null`.

**Root cause (found via `e2e/file-explorer.e2e.test.ts`):** the GitGraspPool L2
cache (`src/lib/git-grasp-pool/cache.ts`) called `indexedDB.open(...)`
unconditionally. `indexedDB` is **undefined in node**, so every cache read
(`idbGet`, awaited at the top of `GitHttpClient.fetchInfoRefs` before the
network fetch) threw `ReferenceError: indexedDB is not defined`. That rejection
propagated up, the URL was recorded as a permanent failure, and the pool ended
in "Could not reach any clone URL" — which `getFullTree`/`withFallback` then
surfaced as `null`. It was an **environment bug in the harness path, not a
production browser bug.**

**Fix (committed):** `cache.ts` now detects `typeof indexedDB === "undefined"`
once (`idbAvailable`) and makes `idbGet`/`idbPut` resolve to no-ops in that
case, so the cache degrades cleanly to L1-only. Production (browser) behaviour
is unchanged. With this fix the merge test passes end-to-end when un-skipped
(verified locally, then re-skipped per the task split).

## Verifying the file-list / README path — DONE

`e2e/file-explorer.e2e.test.ts` drives the REAL `GitGraspPool` read path the
repo landing page + `useGitExplorer` use: `pool.subscribe()` resolves the
default-branch tip, populates `latestCommit`/`readmeContent`/`defaultBranch`,
then `getInfoRefs()` + `getTree()` + `getObjectByPath()`/`getBlob()` return the
file list and README bytes. All assertions pass against live grasp.

## The Merge-button path (was "The actual bug")

**No reproducible bug in the merge orchestration itself** — with the
indexedDB-in-node pool fix the full path (`buildPatchChainObjects` →
`performMerge` → kind:30618 state → packfile push into purgatory → kind:1631
status) runs green against live grasp. The original blocker was the harness
environment bug above (indexedDB undefined in node), not a production browser
bug.

If a Merge-button problem resurfaces in the browser, candidates to investigate
next (none currently reproduced):

- `getFullTree` failing against a real grasp server in the browser would land
  the merge check (`usePatchMergeability`) in `error`/`conflicts`, so the green
  Merge button never appears, or `handleMerge`'s `buildResult` is null and the
  click is a no-op. Distinguish "button does nothing" vs "push rejected".
- Downstream: purgatory/auth on the kind:30618 push (401/403 from
  `getReceivePackRefs`), wrong merge-base (timestamp guess), or the status
  never landing.

**Next test to write:** the negative purgatory authorization case — seed a repo
as `maintainer`, then attempt a kind:30618 state + push signed by a _different_
npub and assert grasp rejects it (push refused / ref unchanged).

## Rules reminder

- e2e code imports ONLY `e2e/harness`, the pure `@/lib/git-*` libs, the
  factories, and `nostr-tools`. Never `pool`/`publish`/`outboxStore` from
  `@/services/nostr`.
- Don't add e2e tests to the default `pnpm test` run.
- Commit when green: `pnpm test:e2e` (with the binary) AND `pnpm pre-commit`.
