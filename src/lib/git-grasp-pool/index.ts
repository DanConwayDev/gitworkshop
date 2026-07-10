/**
 * git-grasp-pool — public API
 *
 * Single entry point for the library. Consumers import from here.
 */

// --- Core class ---
export { GitGraspPool } from "./pool";

// --- Registry ---
export {
  getOrCreatePool,
  peekPool,
  removePool,
  clearRegistry,
} from "./registry";
export type { GetPoolOptions } from "./registry";

// --- Types ---
export type {
  // Pool state
  PoolState,
  PoolHealth,
  PoolOptions,
  PoolSubscriber,
  PoolWarning,
  RefDiscrepancy,
  // URL state
  UrlState,
  UrlConnectionStatus,
  UrlRefStatus,
  UrlErrorKind,
  ObjectFetchOutcome,
  ObjectFetchResult,
  // State event
  StateEvent,
  StateEventInput,
  StateEventRef,
  // Error classification
  ErrorClass,
  // Re-exported library types
  Commit,
  Tree,
  InfoRefsUploadPackResponse,
  // Diff data
  CommitRangeData,
} from "./types";

// --- CORS proxy (for UI components that need to display proxy status) ---
export { CorsProxyManager, DEFAULT_CORS_PROXY_BASE } from "./cors-proxy";

// --- Cache (for advanced consumers that need direct cache access) ---
export { GitObjectCache } from "./cache";

// --- Git HTTP (for advanced consumers) ---
export {
  GitHttpClient,
  GitFetchError,
  PermanentFetchError,
  classifyFetchError,
  isNonHttpUrl,
} from "./git-http";

// --- Diff processing ---
export { diffTrees, generateUnifiedDiff } from "./diff-utils";
export type { FileChange, FileChangeStatus } from "./diff-utils";

// --- Multi-server Grasp push ---
export {
  pushRefUpdateToGraspServers,
  pushToGraspServer,
  getPostPushStateRefs,
  uniquePackableObjects,
  summarizePushDelivery,
  formatCloneUrlHost,
  getGitRemoteHostname,
} from "./grasp-push";
export type {
  PushDeliveryOutcome,
  PushDeliverySummary,
  DesiredStateRef,
  CatchUpObjectFetcher,
  GraspPushContext,
  PushRefUpdateParams,
} from "./grasp-push";

// --- Merge orchestration ---
export {
  performMerge,
  performPRMerge,
  performApplyToTip,
  signMergedStatus,
  buildPRNevent,
  createCommitPersonNow,
} from "./merge";
export type {
  MergeSigner,
  PerformMergeStep,
  PatchEventRef,
  GraspMergeContext,
  GraspMergeTransports,
  IssueAutoResolveContext,
  PerformMergeParams,
  PerformMergeResult,
  PerformPRMergeParams,
  PerformPRMergeResult,
  PerformApplyToTipParams,
  PerformApplyToTipResult,
} from "./merge";

// --- Issue auto-resolution from commit keywords (ngit parity) ---
export {
  extractIssueResolutionMentions,
  resolveIssueReference,
  collectIssueResolutions,
  createIssueResolutionContent,
  signIssueResolutionStatus,
  parseCommitsFromPackableObjects,
} from "@/lib/issue-auto-resolve";
export type {
  IssueCandidate,
  IssueReferenceToken,
  IssueResolutionMention,
  IssueResolution,
  IssueReferenceResolution,
  CollectIssueResolutionsParams,
} from "@/lib/issue-auto-resolve";

// --- Already-merged detection ---
export {
  findDetectedNgitMergeCommit,
  findDetectedNgitMergeCommitInHistory,
  DETECTED_MERGE_HISTORY_MAX_WITHOUT_BASE,
  DETECTED_MERGE_HISTORY_MAX_WITH_BASE,
  DETECTED_MERGE_HISTORY_LOOKBACK_STEP,
} from "./detect-merged";
export type {
  DetectedMergeCommit,
  DetectedMergeScanResult,
} from "./detect-merged";
