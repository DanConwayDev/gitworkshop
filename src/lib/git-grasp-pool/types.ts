/**
 * git-grasp-pool — shared types
 *
 * All public types used across the library. Consumers import from here
 * (or from the barrel index.ts).
 */

import type { Observable } from "rxjs";
import type {
  Commit,
  Tree,
  InfoRefsUploadPackResponse,
} from "@fiatjaf/git-natural-api";

// Re-export library types that appear in our public API
export type { Commit, Tree, InfoRefsUploadPackResponse };

// ---------------------------------------------------------------------------
// Per-URL state
// ---------------------------------------------------------------------------

/** Connection status for a single clone URL */
export type UrlConnectionStatus =
  | "untested"
  | "ok"
  | "error"
  | "permanent-failure";

/** Full tracked state for a single clone URL */
export interface UrlState {
  url: string;
  /** The original (non-proxy) URL — always the same as `url` */
  originalUrl: string;
  /** The effective URL used for HTTP requests (may be proxy-prefixed) */
  effectiveUrl: string;
  status: UrlConnectionStatus;
  /** Whether this URL is routed through the CORS proxy */
  usesProxy: boolean;
  /** The parsed infoRefs response, if successfully fetched */
  infoRefs: InfoRefsUploadPackResponse | null;
  /** HEAD commit hash derived from infoRefs symrefs */
  headCommit: string | null;
  /** HEAD ref name (e.g. "refs/heads/main") */
  headRef: string | null;
  /** Whether the server supports the "filter" capability */
  supportsFilter: boolean;
  /** Server capabilities list */
  capabilities: string[];
  /** Rolling average latency (ms) of recent successful fetches */
  latencyMs: number | null;
  /** Error message from the most recent failure, if any */
  lastError: string | null;
  /** Timestamp (ms) of the last successful fetch */
  lastSuccessAt: number | null;
}

// ---------------------------------------------------------------------------
// Nostr state event
// ---------------------------------------------------------------------------

/** A ref declared by a Nostr state event (kind:30618) */
export interface StateEventRef {
  /** Full ref name, e.g. "refs/heads/main" */
  name: string;
  /** Commit hash */
  commitId: string;
}

/**
 * The Nostr state event data the pool needs. Callers map their own event
 * representation into this shape.
 *
 * `undefined` = still loading (haven't checked relays yet)
 * `null`      = confirmed no state event exists
 * `StateEvent`= have a state event
 */
export interface StateEvent {
  /** HEAD commit declared by the state event */
  headCommitId: string;
  /** All refs declared by the state event */
  refs: StateEventRef[];
  /** created_at timestamp (seconds) of the state event */
  createdAt: number;
}

export type StateEventInput = StateEvent | null | undefined;

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/**
 * Warnings computed by comparing the Nostr state event against what git
 * servers actually report.
 */
export type PoolWarning =
  | {
      kind: "state-commit-unavailable";
      /** The commit the state event declares, which no git server has */
      stateCommitId: string;
    }
  | {
      kind: "state-behind-git";
      /** The commit the state event declares */
      stateCommitId: string;
      /** The newer commit a git server has */
      gitCommitId: string;
      /** Which git server reported the newer commit */
      gitServerUrl: string;
      /** created_at of the state event (seconds) */
      stateCreatedAt: number;
      /** committer timestamp of the git server's commit (seconds) */
      gitCommitterDate: number;
    };

// ---------------------------------------------------------------------------
// Pool state (observable)
// ---------------------------------------------------------------------------

/** Overall health of the pool */
export type PoolHealth =
  | "idle"
  | "connecting"
  | "ok"
  | "degraded"
  | "all-failed";

/** The full observable state exposed to UI consumers */
export interface PoolState {
  /** Per-URL state, keyed by original clone URL */
  urls: Record<string, UrlState>;
  /** The URL that won the initial race (best latency + success) */
  winnerUrl: string | null;
  /** Overall pool health */
  health: PoolHealth;
  /** True while the initial infoRefs race is in progress */
  loading: boolean;
  /**
   * True when stale cached data is being shown while a fresh fetch is
   * in flight (stale-while-revalidate).
   */
  pulling: boolean;
  /** The latest commit from the winning URL (or best available) */
  latestCommit: Commit | null;
  /** README content if fetched as part of the commit pipeline */
  readmeContent: string | null;
  /** README filename (e.g. "README.md") */
  readmeFilename: string | null;
  /** Default branch name from the git server's HEAD symref */
  defaultBranch: string | null;
  /** Warning from state event vs git server comparison */
  warning: PoolWarning | null;
  /** Error message when all URLs have failed */
  error: string | null;
  /**
   * Unix timestamp (seconds) of the last successful git server fetch.
   * null if no fetch has completed yet.
   */
  lastCheckedAt: number | null;
}

// ---------------------------------------------------------------------------
// Pool options
// ---------------------------------------------------------------------------

/** Configuration for creating a GitGraspPool */
export interface PoolOptions {
  /** Initial set of clone URLs. More can be added later via addUrls(). */
  cloneUrls: string[];
  /**
   * Observable that emits the current Nostr state event for this repo.
   * - undefined = still loading
   * - null = confirmed no state event
   * - StateEvent = have state event data
   */
  stateEvent$?: Observable<StateEventInput>;
  /**
   * CORS proxy base URL. Defaults to "https://cors.isomorphic-git.org".
   * Set to null to disable CORS proxy entirely.
   */
  corsProxyBase?: string | null;
  /**
   * Domains that are hardcoded to always use the CORS proxy.
   * Defaults to ["github.com", "gitlab.com", "codeberg.org", "gitea.com"].
   */
  knownCorsBlockedOrigins?: string[];
  /**
   * How long (ms) to keep the pool alive after the last subscriber leaves.
   * Defaults to 60_000 (1 minute).
   */
  evictionGracePeriodMs?: number;
  /**
   * How long (ms) an infoRefs cache entry is considered fresh.
   * Defaults to 60_000 (1 minute).
   */
  infoRefsTtlMs?: number;
}

// ---------------------------------------------------------------------------
// Pool subscriber callback
// ---------------------------------------------------------------------------

export type PoolSubscriber = (state: PoolState) => void;

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/** Whether a fetch error is worth retrying */
export type ErrorClass = "permanent" | "transient";
