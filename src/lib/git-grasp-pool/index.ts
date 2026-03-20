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
} from "./types";

// --- CORS proxy (for UI components that need to display proxy status) ---
export { CorsProxyManager, DEFAULT_CORS_PROXY_BASE } from "./cors-proxy";

// --- Cache (for advanced consumers that need direct cache access) ---
export { GitObjectCache } from "./cache";

// --- Git HTTP (for advanced consumers) ---
export {
  GitHttpClient,
  PermanentFetchError,
  classifyFetchError,
} from "./git-http";
