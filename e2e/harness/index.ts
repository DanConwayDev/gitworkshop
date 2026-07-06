/**
 * e2e harness — public API.
 *
 * These helpers spin up a real `ngit-grasp` server and drive the app's own git
 * + Nostr libraries against it, with NO access to production relays (the relay
 * client talks to a raw WebSocket URL only). Use them to write end-to-end tests
 * for flows that genuinely need a git server — most notably the Merge button.
 *
 * See `e2e/README.md` for the rationale and `e2e/harness.e2e.test.ts` for a
 * minimal smoke test.
 */

export {
  GraspServer,
  graspBinaryAvailable,
  type GraspServerOptions,
} from "./grasp-server";
export { TestSigner } from "./test-signer";
export { RelayClient } from "./relay-client";
export {
  seedRepo,
  seedMultiServerRepo,
  advanceBranch,
  seedTag,
  buildAnnouncement,
  buildState,
  buildStateWithRefs,
  waitUntilAfterUnixSecond,
  npubToHex,
  REPO_KIND,
  REPO_STATE_KIND,
  type SeedRepoOptions,
  type SeededRepo,
  type SeededRepoServer,
  type SeededMultiServerRepo,
  type AdvanceBranchOptions,
  type AdvanceBranchResult,
  type SeedTagOptions,
  type SeedTagResult,
} from "./repo-fixture";
export {
  seedPatchPR,
  type SeedPatchPROptions,
  type SeededPatchPR,
} from "./seed-patch-pr";
export {
  seedKindPR,
  type SeedKindPROptions,
  type SeededKindPR,
} from "./seed-kind-pr";
export {
  makePoolTransports,
  type MakePoolTransportsOptions,
  type PoolTransportsResult,
} from "./merge-transports";
