import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for end-to-end tests that require a real `ngit-grasp` server.
 *
 * These are intentionally separate from the default unit-test run:
 *   - `pnpm test` / `pnpm pre-commit` do NOT run these (they `exclude` e2e).
 *   - Run them explicitly with `pnpm test:e2e`.
 *   - Each suite gates itself on `graspBinaryAvailable()` (skips cleanly when
 *     no ngit-grasp binary is present), so running this config on a machine
 *     without the binary is a no-op rather than a failure.
 *
 * Environment is `node` (not jsdom): the merge/git/relay layers use only
 * Web-standard APIs (`fetch`, `WebSocket`, `crypto.subtle`, `TextEncoder`)
 * which Node 22+ provides natively, and a real DOM would only get in the way.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./e2e/setup.ts"],
    include: ["e2e/**/*.e2e.test.ts"],
    // Spawning a subprocess + git push + relay round-trips are slow relative
    // to unit tests; give them room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Each e2e suite owns a grasp subprocess on its own port; running files
    // sequentially keeps resource use predictable and logs readable.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
