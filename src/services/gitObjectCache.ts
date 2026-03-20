/**
 * Content-addressed git object cache backed by IndexedDB.
 *
 * Git objects are immutable and globally unique by their SHA-1 hash — the
 * same hash always means the same content, regardless of which clone URL or
 * repository served it. This cache exploits that property:
 *
 *   - Commit metadata  → keyed by commitHash
 *   - Blob content     → keyed by objectHash (the blob's SHA-1)
 *   - README text      → keyed by `${commitHash}:${path}` (derived, but still
 *                        immutable once the commit exists)
 *   - InfoRefs result  → keyed by cloneUrl (URL-scoped, NOT content-addressed;
 *                        stored here for convenience but with a short TTL)
 *
 * The cache is shared across all tabs via IndexedDB and survives page refresh.
 * Entries never need invalidation except for infoRefs (which has a TTL).
 */

import type {
  Commit,
  InfoRefsUploadPackResponse,
  Tree,
} from "@fiatjaf/git-natural-api";

// ---------------------------------------------------------------------------
// IndexedDB setup
// ---------------------------------------------------------------------------

const DB_NAME = "ngitstack-git-cache";
// Bumped to 3 to match git-grasp-pool/cache.ts which owns the same database.
// The schema is identical — both modules use the same 5 stores.
const DB_VERSION = 3;

const STORE_COMMITS = "commits";
const STORE_BLOBS = "blobs";
const STORE_INFO_REFS = "infoRefs";
const STORE_TREES = "trees";
const STORE_COMMIT_HISTORY = "commitHistory";

/** How long (ms) an infoRefs entry is considered fresh before re-fetching. */
export const INFO_REFS_TTL_MS = 60_000; // 1 minute

interface CommitRecord {
  hash: string;
  commit: Commit;
}

interface BlobRecord {
  hash: string;
  /** Raw bytes stored as Uint8Array */
  data: Uint8Array;
}

interface InfoRefsRecord {
  url: string;
  info: InfoRefsUploadPackResponse;
  fetchedAt: number; // Date.now()
}

interface TreeRecord {
  /** `${commitHash}:${nestLimit}` */
  key: string;
  tree: Tree;
}

interface CommitHistoryRecord {
  /** `${commitHash}:${maxCommits}` */
  key: string;
  commits: Commit[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_COMMITS)) {
        db.createObjectStore(STORE_COMMITS, { keyPath: "hash" });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: "hash" });
      }
      if (!db.objectStoreNames.contains(STORE_INFO_REFS)) {
        db.createObjectStore(STORE_INFO_REFS, { keyPath: "url" });
      }
      if (!db.objectStoreNames.contains(STORE_TREES)) {
        db.createObjectStore(STORE_TREES, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_COMMIT_HISTORY)) {
        db.createObjectStore(STORE_COMMIT_HISTORY, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbPut(storeName: string, value: unknown): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const req = tx.objectStore(storeName).put(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
  );
}

// ---------------------------------------------------------------------------
// In-memory L1 cache (avoids redundant IDB reads within a session)
// ---------------------------------------------------------------------------

const memCommits = new Map<string, Commit>();
const memBlobs = new Map<string, Uint8Array>();
/** key: `${commitHash}:${path}` → decoded text */
const memTexts = new Map<string, string>();
/**
 * key: `${commitHash}:${nestLimit}` → Tree
 *
 * Trees are content-addressed: the same commitHash + nestLimit always yields
 * the same result, so this cache never needs invalidation.
 */
const memTrees = new Map<string, Tree>();
/** key: cloneUrl → { info, fetchedAt } */
const memInfoRefs = new Map<
  string,
  { info: InfoRefsUploadPackResponse; fetchedAt: number }
>();
/**
 * key: `${commitHash}:${maxCommits}` → Commit[]
 *
 * Commit history is content-addressed by the tip commit hash + depth limit.
 * Memory-only — the list can be large and is cheap to re-fetch if the tab
 * is closed.
 */
const memCommitHistory = new Map<string, Commit[]>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a cached commit by its hash.
 * Checks memory first, then IndexedDB.
 */
export async function getCachedCommit(
  hash: string,
): Promise<Commit | undefined> {
  const mem = memCommits.get(hash);
  if (mem) return mem;
  const record = await idbGet<CommitRecord>(STORE_COMMITS, hash);
  if (record) {
    memCommits.set(hash, record.commit);
    return record.commit;
  }
  return undefined;
}

/**
 * Store a commit in both memory and IndexedDB.
 */
export function cacheCommit(commit: Commit): void {
  memCommits.set(commit.hash, commit);
  idbPut(STORE_COMMITS, { hash: commit.hash, commit }).catch(() => {
    // Non-critical — in-memory cache still works
  });
}

/**
 * Get a cached blob by its object hash.
 * Checks memory first, then IndexedDB.
 */
export async function getCachedBlob(
  hash: string,
): Promise<Uint8Array | undefined> {
  const mem = memBlobs.get(hash);
  if (mem) return mem;
  const record = await idbGet<BlobRecord>(STORE_BLOBS, hash);
  if (record) {
    memBlobs.set(hash, record.data);
    return record.data;
  }
  return undefined;
}

/**
 * Store a blob in both memory and IndexedDB.
 */
export function cacheBlob(hash: string, data: Uint8Array): void {
  memBlobs.set(hash, data);
  idbPut(STORE_BLOBS, { hash, data }).catch(() => {
    // Non-critical
  });
}

/**
 * Get cached decoded text for a blob at a specific commit path.
 * This is a derived cache — if the blob is cached we can decode it on demand,
 * but we also cache the decoded string to avoid repeated TextDecoder calls.
 * Key: `${commitHash}:${path}`
 */
export function getCachedText(
  commitHash: string,
  path: string,
): string | undefined {
  return memTexts.get(`${commitHash}:${path}`);
}

/**
 * Store decoded text for a commit+path combination.
 */
export function cacheText(
  commitHash: string,
  path: string,
  text: string,
): void {
  memTexts.set(`${commitHash}:${path}`, text);
}

/**
 * Synchronous memory-only peek for infoRefs, respecting TTL.
 * Returns the cached value only if present and still fresh.
 * Use this for zero-latency checks (e.g. avoiding a loading flash on remount).
 */
export function peekCachedInfoRefs(
  url: string,
): InfoRefsUploadPackResponse | undefined {
  const mem = memInfoRefs.get(url);
  if (mem && Date.now() - mem.fetchedAt < INFO_REFS_TTL_MS) return mem.info;
  return undefined;
}

/**
 * Synchronous memory-only peek for infoRefs, ignoring TTL.
 * Returns any cached value regardless of age.
 *
 * Safe to use for resolving a commit hash when the tree is already cached:
 * the tree is content-addressed so it never goes stale even if infoRefs is
 * old. The slow path will still re-fetch infoRefs from the network.
 */
export function peekCachedInfoRefsStale(
  url: string,
): InfoRefsUploadPackResponse | undefined {
  return memInfoRefs.get(url)?.info;
}

/**
 * Synchronous memory-only peek for a commit.
 * Returns the cached commit if present in the L1 cache, without touching IDB.
 */
export function peekCachedCommit(hash: string): Commit | undefined {
  return memCommits.get(hash);
}

/**
 * Synchronous memory-only peek for a blob.
 * Returns the raw bytes if present in the L1 cache, without touching IDB.
 */
export function peekCachedBlob(hash: string): Uint8Array | undefined {
  return memBlobs.get(hash);
}

/**
 * Get cached infoRefs for a clone URL, if still within TTL.
 * Returns undefined if missing or stale.
 */
export async function getCachedInfoRefs(
  url: string,
): Promise<InfoRefsUploadPackResponse | undefined> {
  // Check memory first
  const mem = memInfoRefs.get(url);
  if (mem && Date.now() - mem.fetchedAt < INFO_REFS_TTL_MS) {
    return mem.info;
  }

  // Check IDB
  const record = await idbGet<InfoRefsRecord>(STORE_INFO_REFS, url);
  if (record && Date.now() - record.fetchedAt < INFO_REFS_TTL_MS) {
    memInfoRefs.set(url, { info: record.info, fetchedAt: record.fetchedAt });
    return record.info;
  }

  return undefined;
}

/**
 * Store infoRefs for a clone URL with the current timestamp.
 */
export function cacheInfoRefs(
  url: string,
  info: InfoRefsUploadPackResponse,
): void {
  const fetchedAt = Date.now();
  memInfoRefs.set(url, { info, fetchedAt });
  idbPut(STORE_INFO_REFS, { url, info, fetchedAt }).catch(() => {
    // Non-critical
  });
}

/**
 * Invalidate the infoRefs cache for a specific URL (e.g. after a known push).
 * Forces the next getInfoRefs call to go to the network.
 */
export function invalidateInfoRefs(url: string): void {
  memInfoRefs.delete(url);
}

/**
 * Get a cached directory tree for a commit + nest depth combination.
 *
 * Trees are content-addressed: commitHash + nestLimit fully determines the
 * result, so no TTL or invalidation is needed.
 * Checks memory first, then IndexedDB.
 *
 * Key: `${commitHash}:${nestLimit}`
 */
export async function getCachedTree(
  commitHash: string,
  nestLimit: number,
): Promise<Tree | undefined> {
  const k = `${commitHash}:${nestLimit}`;
  const mem = memTrees.get(k);
  if (mem) return mem;
  const record = await idbGet<TreeRecord>(STORE_TREES, k);
  if (record) {
    memTrees.set(k, record.tree);
    return record.tree;
  }
  return undefined;
}

/**
 * Synchronous memory-only peek for a tree.
 */
export function peekCachedTree(
  commitHash: string,
  nestLimit: number,
): Tree | undefined {
  return memTrees.get(`${commitHash}:${nestLimit}`);
}

/**
 * Store a directory tree for a commit + nest depth combination in memory and IDB.
 */
export function cacheTree(
  commitHash: string,
  nestLimit: number,
  tree: Tree,
): void {
  const k = `${commitHash}:${nestLimit}`;
  memTrees.set(k, tree);
  idbPut(STORE_TREES, { key: k, tree }).catch(() => {
    // Non-critical
  });
}

/**
 * Get a cached commit history list for a tip commit + depth combination.
 *
 * Commit history is content-addressed: the same tip commitHash + maxCommits
 * always yields the same list, so no TTL or invalidation is needed.
 * Checks memory first, then IndexedDB.
 *
 * Key: `${commitHash}:${maxCommits}`
 */
export async function getCachedCommitHistory(
  commitHash: string,
  maxCommits: number,
): Promise<Commit[] | undefined> {
  const k = `${commitHash}:${maxCommits}`;
  const mem = memCommitHistory.get(k);
  if (mem) return mem;
  const record = await idbGet<CommitHistoryRecord>(STORE_COMMIT_HISTORY, k);
  if (record) {
    memCommitHistory.set(k, record.commits);
    return record.commits;
  }
  return undefined;
}

/**
 * Synchronous memory-only peek for a commit history list.
 */
export function peekCachedCommitHistory(
  commitHash: string,
  maxCommits: number,
): Commit[] | undefined {
  return memCommitHistory.get(`${commitHash}:${maxCommits}`);
}

/**
 * Store a commit history list for a tip commit + depth combination in memory and IDB.
 */
export function cacheCommitHistory(
  commitHash: string,
  maxCommits: number,
  commits: Commit[],
): void {
  const k = `${commitHash}:${maxCommits}`;
  memCommitHistory.set(k, commits);
  idbPut(STORE_COMMIT_HISTORY, { key: k, commits }).catch(() => {
    // Non-critical
  });
}
