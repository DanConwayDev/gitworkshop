/**
 * File-explorer e2e test.
 *
 * Exercises the REAL "browse a repo" read path against a live ngit-grasp
 * server — the same `GitGraspPool` the file explorer (`useGitExplorer`) and the
 * repo landing page drive, with no mocks of the git layer:
 *
 *   1. seedRepo()        — announce → state → push an initial commit carrying a
 *                          README plus a couple of nested files.
 *   2. pool.subscribe()  — the production trigger. The pool fetches info/refs,
 *                          resolves the default branch tip, fetches that commit
 *                          (blob:none tree + README blob), and populates
 *                          `latestCommit` / `readmeContent` / `defaultBranch`
 *                          on its observable state — exactly what the repo
 *                          landing page renders.
 *   3. pool.getInfoRefs()/getTree() — the explorer's Phase 1 + Phase 2: resolve
 *                          the default branch commit, then fetch the directory
 *                          tree for the file list.
 *   4. pool.getObjectByPath()/getBlob() — fetch the README blob content the way
 *                          the file viewer does, and verify it round-trips.
 *
 * Assertions:
 *   - The pool resolves the default branch tip to the commit we pushed.
 *   - `poolState.latestCommit` and `poolState.readmeContent` settle to the
 *     pushed commit and the seeded README text.
 *   - `getTree` lists every seeded path (the file list).
 *   - `getObjectByPath` / `getBlob` return the seeded README bytes verbatim.
 *
 * Transport: the pool talks ONLY to the local grasp clone URL (CORS proxy
 * disabled); the RelayClient talks ONLY to the local grasp relay. Never
 * `@/services/nostr`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  GraspServer,
  RelayClient,
  TestSigner,
  seedRepo,
  graspBinaryAvailable,
  type SeededRepo,
} from "./harness";
import { GitGraspPool } from "@/lib/git-grasp-pool";
import type { PoolState, Tree } from "@/lib/git-grasp-pool";

const describeIfGrasp = graspBinaryAvailable() ? describe : describe.skip;

const FILES = {
  "README.md": "# explorer repo\n\nseeded readme line one\nline two\n",
  "src/index.ts": "export const answer = 42;\n",
  "docs/guide.md": "# guide\n\nhello\n",
};

/** Recursively collect every file path present in a parsed tree. */
function collectFilePaths(tree: Tree | null, prefix = ""): string[] {
  if (!tree) return [];
  const out: string[] = [];
  for (const file of tree.files) {
    out.push(prefix ? `${prefix}/${file.name}` : file.name);
  }
  for (const dir of tree.directories) {
    const full = prefix ? `${prefix}/${dir.name}` : dir.name;
    out.push(...collectFilePaths(dir.content, full));
  }
  return out;
}

describeIfGrasp(
  "e2e — file explorer (file list + README on default tip)",
  () => {
    let server: GraspServer;
    let relay: RelayClient;
    let maintainer: TestSigner;
    let repo: SeededRepo;
    let pool: GitGraspPool;

    beforeAll(async () => {
      server = await GraspServer.start({ role: "explorer" });
      relay = await RelayClient.connect(server.relayUrl);
      maintainer = new TestSigner();

      repo = await seedRepo(server, relay, maintainer, {
        identifier: "explorer-repo",
        name: "Explorer Repo",
        files: FILES,
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

    it("resolves the default branch tip and renders the README + file list", async () => {
      // ── 1. Subscribe — the production trigger for the initial fetch. ───────
      // Wait until the pool has resolved the latest commit (or errored).
      const settled = await new Promise<PoolState>((resolve, reject) => {
        const timeout = setTimeout(() => {
          unsubscribe();
          reject(new Error("pool did not settle within 15s"));
        }, 15_000);
        const unsubscribe = pool.subscribe((state) => {
          if (state.error) {
            clearTimeout(timeout);
            unsubscribe();
            reject(new Error(`pool error: ${state.error}`));
            return;
          }
          if (state.latestCommit) {
            clearTimeout(timeout);
            unsubscribe();
            resolve(state);
          }
        });
      });

      // The pool resolved the commit we pushed as the default-branch tip.
      expect(settled.latestCommit?.hash).toBe(repo.headCommit);
      expect(settled.defaultBranch).toBe(repo.branch);

      // The repo landing page renders this README straight from pool state.
      expect(settled.readmeContent).toBe(FILES["README.md"]);
      expect(settled.readmeFilename).toBe("README.md");

      // ── 2. Explorer Phase 1: resolve default branch tip from info/refs. ────
      const info = pool.getInfoRefs();
      expect(info).not.toBeNull();
      const headRef = info!.symrefs["HEAD"];
      expect(headRef).toBe(`refs/heads/${repo.branch}`);
      const tipCommit = info!.refs[headRef];
      expect(tipCommit).toBe(repo.headCommit);

      // ── 3. Explorer Phase 2: fetch the directory tree (the file list). ─────
      const abort = new AbortController();
      const tree = await pool.getTree(tipCommit, 3, abort.signal);
      expect(tree).not.toBeNull();

      const paths = collectFilePaths(tree).sort();
      expect(paths).toEqual(Object.keys(FILES).sort());

      // ── 4. File viewer: fetch the README blob content by path. ─────────────
      const readmeObj = await pool.getObjectByPath(
        tipCommit,
        "README.md",
        abort.signal,
      );
      expect(readmeObj).not.toBeNull();
      expect(readmeObj!.isDir).toBe(false);
      expect(readmeObj!.hash).toBe(repo.blobHashes["README.md"]);

      // The blob bytes round-trip to the exact seeded README text.
      const blob =
        readmeObj!.data ?? (await pool.getBlob(readmeObj!.hash, abort.signal));
      expect(blob).not.toBeNull();
      expect(new TextDecoder().decode(blob!)).toBe(FILES["README.md"]);
    });
  },
);
