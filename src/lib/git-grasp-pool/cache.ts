/**
 * git-grasp-pool — content-addressed git object cache
 *
 * Two-tier cache: L1 in-memory (Map) for zero-latency synchronous peeks,
 * backed by L2 IndexedDB for cross-tab persistence and page-reload survival.
 *
 * Git objects are immutable and globally unique by SHA-1 hash, so entries
 * never need invalidation — except infoRefs which has a configurable TTL.
 *
 * The cache is shared across all pool instances via a singleton IDB database.
 * L1 memory caches are module-level so they survive pool disposal (the data
 * is still valid for any future pool with the same URLs).
 */

import type {
  Commit,
  Tree,
  InfoRefsUploadPackResponse,
} from "@fiatjaf/git-natural-api";

// ---------------------------------------------------------------------------
// IndexedDB setup
// ---------------------------------------------------------------------------

// Keep the same DB name as the old gitObjectCache so existing cached data
// (commits, blobs, infoRefs) survives the migration without a cold-cache reload.
// DB_VERSION bumped from 2 → 3 to add the new "trees" and "commitHistory" stores
// that didn't exist in the old schema.
const DB_NAME = "ngitstack-git-cache";
const DB_VERSION = 3;

const STORE_COMMITS = "commits";
const STORE_BLOBS = "blobs";
const STORE_INFO_REFS = "infoRefs";
const STORE_TREES = "trees";
const STORE_COMMIT_HISTORY = "commitHistory";

/** Default TTL for infoRefs entries */
export const DEFAULT_INFO_REFS_TTL_MS = 60_000; // 1 minute

// IDB record types
interface CommitRecord {
  hash: string;
  commit: Commit;
}

interface BlobRecord {
  hash: string;
  data: Uint8Array;
}

interface InfoRefsRecord {
  url: string;
  info: InfoRefsUploadPackResponse;
  fetchedAt: number;
}

interface TreeRecord {
  key: string; // `${commitHash}:${nestLimit}`
  tree: Tree;
}

interface CommitHistoryRecord {
  key: string; // `${commitHash}:${maxCommits}`
  commits: Commit[];
}

// ---------------------------------------------------------------------------
// IDB helpers
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_COMMITS))
        db.createObjectStore(STORE_COMMITS, { keyPath: "hash" });
      if (!db.objectStoreNames.contains(STORE_BLOBS))
        db.createObjectStore(STORE_BLOBS, { keyPath: "hash" });
      if (!db.objectStoreNames.contains(STORE_INFO_REFS))
        db.createObjectStore(STORE_INFO_REFS, { keyPath: "url" });
      if (!db.objectStoreNames.contains(STORE_TREES))
        db.createObjectStore(STORE_TREES, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORE_COMMIT_HISTORY))
        db.createObjectStore(STORE_COMMIT_HISTORY, { keyPath: "key" });
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
// L1 in-memory caches (module-level singletons)
// ---------------------------------------------------------------------------

const memCommits = new Map<string, Commit>();
const memBlobs = new Map<string, Uint8Array>();
/** key: `${commitHash}:${path}` → decoded text */
const memTexts = new Map<string, string>();
/** key: `${commitHash}:${nestLimit}` → Tree */
const memTrees = new Map<string, Tree>();
/** key: cloneUrl → { info, fetchedAt } */
const memInfoRefs = new Map<
  string,
  { info: InfoRefsUploadPackResponse; fetchedAt: number }
>();
/** key: `${commitHash}:${maxCommits}` → Commit[] */
const memCommitHistory = new Map<string, Commit[]>();

// ---------------------------------------------------------------------------
// GitObjectCache — the public API
// ---------------------------------------------------------------------------

/**
 * Content-addressed git object cache with L1 memory + L2 IDB tiers.
 *
 * All methods are safe to call from any pool instance. The underlying
 * storage is shared (module-level maps + singleton IDB).
 */
export class GitObjectCache {
  private infoRefsTtlMs: number;

  constructor(infoRefsTtlMs: number = DEFAULT_INFO_REFS_TTL_MS) {
    this.infoRefsTtlMs = infoRefsTtlMs;
  }

  // -----------------------------------------------------------------------
  // Commits
  // -----------------------------------------------------------------------

  /** Synchronous L1-only peek */
  peekCommit(hash: string): Commit | undefined {
    return memCommits.get(hash);
  }

  /** L1 then L2 */
  async getCommit(hash: string): Promise<Commit | undefined> {
    const mem = memCommits.get(hash);
    if (mem) return mem;
    const record = await idbGet<CommitRecord>(STORE_COMMITS, hash);
    if (record) {
      memCommits.set(hash, record.commit);
      return record.commit;
    }
    return undefined;
  }

  /** Store in both L1 and L2 */
  putCommit(commit: Commit): void {
    memCommits.set(commit.hash, commit);
    idbPut(STORE_COMMITS, { hash: commit.hash, commit }).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Blobs
  // -----------------------------------------------------------------------

  peekBlob(hash: string): Uint8Array | undefined {
    return memBlobs.get(hash);
  }

  async getBlob(hash: string): Promise<Uint8Array | undefined> {
    const mem = memBlobs.get(hash);
    if (mem) return mem;
    const record = await idbGet<BlobRecord>(STORE_BLOBS, hash);
    if (record) {
      memBlobs.set(hash, record.data);
      return record.data;
    }
    return undefined;
  }

  putBlob(hash: string, data: Uint8Array): void {
    memBlobs.set(hash, data);
    idbPut(STORE_BLOBS, { hash, data }).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Text (derived from blobs — L1 only, no IDB)
  // -----------------------------------------------------------------------

  getText(commitHash: string, path: string): string | undefined {
    return memTexts.get(`${commitHash}:${path}`);
  }

  putText(commitHash: string, path: string, text: string): void {
    memTexts.set(`${commitHash}:${path}`, text);
  }

  // -----------------------------------------------------------------------
  // InfoRefs (URL-scoped, TTL-based)
  // -----------------------------------------------------------------------

  /** Synchronous L1-only peek, respecting TTL */
  peekInfoRefs(url: string): InfoRefsUploadPackResponse | undefined {
    const mem = memInfoRefs.get(url);
    if (mem && Date.now() - mem.fetchedAt < this.infoRefsTtlMs) return mem.info;
    return undefined;
  }

  /** Synchronous L1-only peek, ignoring TTL (for fast-path rendering) */
  peekInfoRefsStale(url: string): InfoRefsUploadPackResponse | undefined {
    return memInfoRefs.get(url)?.info;
  }

  /** L1 then L2, respecting TTL */
  async getInfoRefs(
    url: string,
  ): Promise<InfoRefsUploadPackResponse | undefined> {
    const mem = memInfoRefs.get(url);
    if (mem && Date.now() - mem.fetchedAt < this.infoRefsTtlMs) return mem.info;
    const record = await idbGet<InfoRefsRecord>(STORE_INFO_REFS, url);
    if (record && Date.now() - record.fetchedAt < this.infoRefsTtlMs) {
      memInfoRefs.set(url, { info: record.info, fetchedAt: record.fetchedAt });
      return record.info;
    }
    return undefined;
  }

  putInfoRefs(url: string, info: InfoRefsUploadPackResponse): void {
    const fetchedAt = Date.now();
    memInfoRefs.set(url, { info, fetchedAt });
    idbPut(STORE_INFO_REFS, { url, info, fetchedAt }).catch(() => {});
  }

  /** Invalidate a specific URL's infoRefs (e.g. after a known push) */
  invalidateInfoRefs(url: string): void {
    memInfoRefs.delete(url);
  }

  // -----------------------------------------------------------------------
  // Trees (content-addressed, no TTL)
  // -----------------------------------------------------------------------

  peekTree(commitHash: string, nestLimit: number): Tree | undefined {
    return memTrees.get(`${commitHash}:${nestLimit}`);
  }

  async getTree(
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

  putTree(commitHash: string, nestLimit: number, tree: Tree): void {
    const k = `${commitHash}:${nestLimit}`;
    memTrees.set(k, tree);
    idbPut(STORE_TREES, { key: k, tree }).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Commit history (content-addressed, no TTL)
  // -----------------------------------------------------------------------

  peekCommitHistory(
    commitHash: string,
    maxCommits: number,
  ): Commit[] | undefined {
    return memCommitHistory.get(`${commitHash}:${maxCommits}`);
  }

  async getCommitHistory(
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

  putCommitHistory(
    commitHash: string,
    maxCommits: number,
    commits: Commit[],
  ): void {
    const k = `${commitHash}:${maxCommits}`;
    memCommitHistory.set(k, commits);
    idbPut(STORE_COMMIT_HISTORY, { key: k, commits }).catch(() => {});
  }
}
