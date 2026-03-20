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

/**
 * Sync status of a single git server for a given ref, relative to the
 * Nostr state event (or relative to the majority of servers when no state
 * event exists).
 *
 * - "match"     : server's commit for this ref matches the signed state
 * - "behind"    : server has a different (older) commit than the signed state
 * - "ahead"     : server has a newer commit than the signed state
 * - "connected" : server is reachable but no ref comparison is possible yet
 *                 (e.g. state event still loading, or ref doesn't exist on server)
 * - "unknown"   : server is untested / still fetching infoRefs
 * - "error"     : permanent failure (unreachable, 404, etc.)
 */
export type UrlRefStatus =
  | "match"
  | "behind"
  | "ahead"
  | "connected"
  | "unknown"
  | "error";

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
  /**
   * Per-ref sync status computed by the pool.
   *
   * Keys are full ref names (e.g. "refs/heads/main", "refs/tags/v1.0").
   * Values are the sync status relative to the Nostr state event, or
   * relative to the majority of servers when no state event exists.
   *
   * Only populated for refs that appear in at least one server's infoRefs.
   * Empty until the first successful infoRefs fetch.
   */
  refStatus: Record<string, UrlRefStatus>;
  /**
   * The commit this server has for each ref.
   * Keys are full ref names. Only populated for refs in infoRefs.
   */
  refCommits: Record<string, string>;
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
// Cross-ref discrepancy
// ---------------------------------------------------------------------------

/**
 * A ref where servers disagree on the commit (relative to the state event
 * or the majority of servers when no state event exists).
 */
export interface RefDiscrepancy {
  /** Full ref name, e.g. "refs/heads/main" */
  refName: string;
  /** Number of servers that disagree with the expected commit */
  disagreeCount: number;
  /** Total number of servers that reported this ref */
  totalServers: number;
}

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
  /**
   * Refs where servers disagree on the commit (relative to the state event
   * or the majority of servers when no state event exists).
   *
   * Computed by the pool after all infoRefs have settled. Empty array when
   * there are fewer than 2 servers or no discrepancies.
   */
  crossRefDiscrepancies: RefDiscrepancy[];
  /**
   * Unix timestamp (ms) of the next scheduled retry, when the pool is in
   * backoff mode waiting for git servers to catch up to the state event.
   * null when no retry is scheduled.
   */
  retryAt: number | null;
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
