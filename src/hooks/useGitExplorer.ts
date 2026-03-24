/**
 * useGitExplorer — reactive git file-tree and file-content hook.
 * useCommitHistory — reactive commit history hook.
 *
 * Both hooks accept a GitGraspPool instance (from useGitPool) rather than
 * clone URLs. This means:
 *   - The pool is already subscribed and fetching before these hooks run.
 *   - No "subscribe briefly to trigger fetch" anti-pattern.
 *   - infoRefs are read from pool.observable reactively; no waitForInfoRefs.
 *   - All git operations (getTree, getBlob, getSingleCommit, getCommitHistory)
 *     route through the pool's winning URL with fallback and cache.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  Commit,
  Tree,
  InfoRefsUploadPackResponse,
} from "@fiatjaf/git-natural-api";
import type { GitGraspPool, PoolState } from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GitRef {
  name: string; // e.g. "main", "v1.0.0"
  hash: string;
  isBranch: boolean;
  isTag: boolean;
  isDefault: boolean;
}

export interface FileEntry {
  name: string;
  path: string; // full path from repo root
  type: "file" | "directory";
}

export interface GitExplorerState {
  loading: boolean;
  error: string | null;
  /** Available refs (branches + tags) from getInfoRefs */
  refs: GitRef[];
  /** The resolved ref name being viewed (e.g. "main", "feat/foo") */
  resolvedRef: string | null;
  /** The resolved file/directory path within the repo (e.g. "src/index.ts") */
  resolvedPath: string | null;
  /** The commit hash for the current ref */
  commitHash: string | null;
  /** The latest commit on the current ref */
  headCommit: Commit | null;
  /** File/directory entries for the current path (directory view) */
  fileTree: FileEntry[] | null;
  /**
   * File/directory entries for the parent directory when viewing a file.
   * Null when viewing a directory or when the file is at the repo root.
   */
  parentFileTree: FileEntry[] | null;
  /** Content of the currently viewed file (if path is a file) */
  fileContent: string | null;
  /** Raw bytes of the currently viewed file (if path is a file) */
  fileBytes: Uint8Array | null;
  /** Whether the current path is a directory */
  isDirectory: boolean;
  /** Whether the current path exists */
  pathExists: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flatten a Tree into FileEntry[] for the given directory path. */
function treeToEntries(tree: Tree, dirPath: string): FileEntry[] {
  const entries: FileEntry[] = [];

  for (const dir of tree.directories) {
    const fullPath = dirPath ? `${dirPath}/${dir.name}` : dir.name;
    entries.push({ name: dir.name, path: fullPath, type: "directory" });
  }
  for (const file of tree.files) {
    const fullPath = dirPath ? `${dirPath}/${file.name}` : file.name;
    entries.push({ name: file.name, path: fullPath, type: "file" });
  }

  // Directories first, then files, both alphabetical
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Navigate a Tree to the subtree at `pathSegments`.
 * Returns undefined if the path doesn't exist or isn't a directory.
 */
function navigateTree(tree: Tree, pathSegments: string[]): Tree | undefined {
  if (pathSegments.length === 0) return tree;
  const [head, ...rest] = pathSegments;
  const dir = tree.directories.find((d) => d.name === head);
  if (!dir || !dir.content) return undefined;
  return navigateTree(dir.content, rest);
}

/**
 * Check if a path points to a file in the tree.
 * Returns the file hash if found, undefined otherwise.
 */
function findFileInTree(
  tree: Tree,
  pathSegments: string[],
): string | undefined {
  if (pathSegments.length === 0) return undefined;
  const [head, ...rest] = pathSegments;

  if (rest.length === 0) {
    // Last segment — check files
    const file = tree.files.find((f) => f.name === head);
    return file?.hash;
  }

  // Navigate into directory
  const dir = tree.directories.find((d) => d.name === head);
  if (!dir?.content) return undefined;
  return findFileInTree(dir.content, rest);
}

/** Parse getInfoRefs result into GitRef[] */
function parseRefs(info: InfoRefsUploadPackResponse): GitRef[] {
  const headRef = info.symrefs["HEAD"]; // e.g. "refs/heads/main"

  const refs: GitRef[] = [];

  for (const [refName, hash] of Object.entries(info.refs)) {
    // Skip peeled tags (^{})
    if (refName.endsWith("^{}")) continue;

    const isBranch = refName.startsWith("refs/heads/");
    const isTag = refName.startsWith("refs/tags/");

    if (!isBranch && !isTag) continue;

    const shortName = isBranch
      ? refName.replace("refs/heads/", "")
      : refName.replace("refs/tags/", "");

    refs.push({
      name: shortName,
      hash,
      isBranch,
      isTag,
      isDefault: refName === headRef,
    });
  }

  // Sort: default branch first, then branches alphabetically, then tags
  return refs.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.isBranch !== b.isBranch) return a.isBranch ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Resolve a combined "ref/path" string against known refs using longest-prefix
 * matching. This handles branch names that contain "/" (e.g. "feat/foo").
 *
 * The input string is everything after /tree/ in the URL, e.g.:
 *   "main"                              → ref=main, path=""
 *   "main/src/index.ts"                 → ref=main, path="src/index.ts"
 *   "feat/foo/src/index.ts"             → ref=feat/foo, path="src/index.ts"
 *   "refs/tags/v1.0/README.md"          → ref=refs/tags/v1.0, path="README.md"
 *
 * Returns undefined if no known ref matches.
 */
function resolveRefAndPath(
  refAndPath: string,
  info: InfoRefsUploadPackResponse,
): { refPath: string; hash: string; path: string } | undefined {
  // Build candidate full ref paths from the refAndPath string by trying each
  // prefix (split on "/") as a branch or tag name.
  const parts = refAndPath.split("/");

  let best:
    | { refPath: string; hash: string; path: string; prefixLen: number }
    | undefined;

  for (let i = 1; i <= parts.length; i++) {
    const candidate = parts.slice(0, i).join("/");
    const path = parts.slice(i).join("/");

    // Try as full refs/ path first
    if (candidate.startsWith("refs/")) {
      const hash = info.refs[candidate];
      if (hash && (!best || i > best.prefixLen)) {
        best = { refPath: candidate, hash, path, prefixLen: i };
      }
      continue;
    }

    // Try as branch name
    const branchPath = `refs/heads/${candidate}`;
    if (info.refs[branchPath] && (!best || i > best.prefixLen)) {
      best = {
        refPath: branchPath,
        hash: info.refs[branchPath],
        path,
        prefixLen: i,
      };
    }

    // Try as tag name
    const tagPath = `refs/tags/${candidate}`;
    if (info.refs[tagPath] && (!best || i > best.prefixLen)) {
      best = {
        refPath: tagPath,
        hash: info.refs[tagPath],
        path,
        prefixLen: i,
      };
    }

    // Try as commit hash (40-char hex) — only valid as the entire ref portion
    if (i === 1 && /^[0-9a-f]{40}$/i.test(candidate)) {
      best = { refPath: candidate, hash: candidate, path, prefixLen: i };
    }
  }

  return best;
}

function shortRefName(refPath: string): string {
  if (refPath.startsWith("refs/heads/"))
    return refPath.replace("refs/heads/", "");
  if (refPath.startsWith("refs/tags/"))
    return refPath.replace("refs/tags/", "");
  return refPath;
}

/**
 * Extract infoRefs from the pool state — returns the first URL's infoRefs
 * that is available, preferring the winner URL.
 */
function getInfoRefsFromState(
  pool: GitGraspPool,
  state: PoolState,
): InfoRefsUploadPackResponse | null {
  // Prefer the winner URL's infoRefs (via pool.getInfoRefs())
  const winner = pool.getInfoRefs();
  if (winner) return winner;

  // Fall back to any URL that has infoRefs — this fires as soon as the first
  // URL in the race completes, rather than waiting for all to settle.
  for (const urlState of Object.values(state.urls)) {
    if (urlState.infoRefs) return urlState.infoRefs;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export interface UseGitExplorerOptions {
  /**
   * Combined "ref/path" string — everything after /tree/ in the URL.
   * The ref is resolved via longest-prefix matching against known git refs,
   * which correctly handles branch names that contain "/" (e.g. "feat/foo").
   * If undefined, uses the default branch and repo root.
   */
  refAndPath?: string;
  /**
   * Known HEAD commit from the Nostr state event (kind:30618).
   * When provided, used as the preferred commit to display.
   */
  knownHeadCommit?: string;
}

/**
 * Fetches the git file tree and file content for a repository path.
 *
 * Requires a GitGraspPool instance from useGitPool — the pool must already
 * be subscribed (which useGitPool guarantees) so that infoRefs are available
 * reactively via pool.observable without any extra subscription tricks.
 *
 * Pass null for pool when cloneUrls is empty; the hook returns an idle state.
 */
export function useGitExplorer(
  pool: GitGraspPool | null,
  poolState: PoolState,
  options: UseGitExplorerOptions = {},
): GitExplorerState & { reload: () => void } {
  const { refAndPath, knownHeadCommit } = options;

  const [state, setState] = useState<GitExplorerState>({
    loading: false,
    error: null,
    refs: [],
    resolvedRef: null,
    resolvedPath: null,
    commitHash: null,
    headCommit: null,
    fileTree: null,
    parentFileTree: null,
    fileContent: null,
    fileBytes: null,
    isDirectory: true,
    pathExists: true,
  });

  const abortRef = useRef<AbortController | null>(null);
  /** True when the fast path has rendered partial state (file list without blob). */
  const partialRenderRef = useRef(false);
  const reloadCounterRef = useRef(0);

  // Stable key for the pool identity — changes when clone URLs change.
  // We use the pool reference itself as the key; if the pool changes, re-run.
  const poolRef = useRef<GitGraspPool | null>(null);

  const run = useCallback(async () => {
    if (!pool) return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const signal = abort.signal;

    // -----------------------------------------------------------------------
    // Fast path: if infoRefs + tree are already in the L1 memory cache we can
    // render immediately without a loading flash. Common case on remount.
    // -----------------------------------------------------------------------
    const fastInfo = pool.getInfoRefs();

    if (fastInfo) {
      const fastParsedRefs = parseRefs(fastInfo);
      let fastCommitHash: string | undefined;
      let fastResolvedRef: string | undefined;
      let fastResolvedPath: string | undefined;

      if (refAndPath) {
        const resolved = resolveRefAndPath(refAndPath, fastInfo);
        if (resolved) {
          fastCommitHash = resolved.hash;
          fastResolvedRef = shortRefName(resolved.refPath);
          fastResolvedPath = resolved.path;
        }
      } else if (knownHeadCommit) {
        fastCommitHash = knownHeadCommit;
        const matchingRef = fastParsedRefs.find(
          (r) => r.hash === knownHeadCommit && r.isBranch,
        );
        fastResolvedRef = matchingRef?.name ?? knownHeadCommit;
        fastResolvedPath = "";
      } else {
        const headRef = fastInfo.symrefs["HEAD"];
        const defaultRef = fastParsedRefs.find(
          (r) => r.isDefault && r.isBranch,
        );
        if (defaultRef) {
          fastCommitHash = headRef ? fastInfo.refs[headRef] : defaultRef.hash;
          fastResolvedRef = defaultRef.name;
          fastResolvedPath = "";
        }
      }

      if (fastCommitHash && fastResolvedRef && fastResolvedPath !== undefined) {
        const fastPathSegments = fastResolvedPath
          ? fastResolvedPath.split("/").filter(Boolean)
          : [];
        const fastNestLimit = fastPathSegments.length + 1;
        const fastTree = pool.cache.peekTree(fastCommitHash, fastNestLimit);
        if (fastTree) {
          // Tree is in memory — attempt a fully-synchronous render.
          const fastHeadCommit = pool.cache.peekCommit(fastCommitHash) ?? null;
          let fastHandled = false;

          if (fastPathSegments.length === 0) {
            setState({
              loading: false,
              error: null,
              refs: fastParsedRefs,
              resolvedRef: fastResolvedRef,
              resolvedPath: fastResolvedPath,
              commitHash: fastCommitHash,
              headCommit: fastHeadCommit,
              fileTree: treeToEntries(fastTree, ""),
              parentFileTree: null,
              fileContent: null,
              fileBytes: null,
              isDirectory: true,
              pathExists: true,
            });
            fastHandled = true;
          } else {
            const subTree = navigateTree(fastTree, fastPathSegments);
            if (subTree) {
              setState({
                loading: false,
                error: null,
                refs: fastParsedRefs,
                resolvedRef: fastResolvedRef,
                resolvedPath: fastResolvedPath,
                commitHash: fastCommitHash,
                headCommit: fastHeadCommit,
                fileTree: treeToEntries(subTree, fastResolvedPath),
                parentFileTree: null,
                fileContent: null,
                fileBytes: null,
                isDirectory: true,
                pathExists: true,
              });
              fastHandled = true;
            } else {
              const fileHash = findFileInTree(fastTree, fastPathSegments);
              if (fileHash) {
                const parentSegments = fastPathSegments.slice(0, -1);
                const parentPath = parentSegments.join("/");
                const parentTree =
                  parentSegments.length === 0
                    ? fastTree
                    : navigateTree(fastTree, parentSegments);
                const parentEntries = parentTree
                  ? treeToEntries(parentTree, parentPath)
                  : null;

                const cachedBlob = pool.cache.peekBlob(fileHash);
                if (cachedBlob !== undefined) {
                  const content = new TextDecoder("utf-8", {
                    fatal: false,
                  }).decode(cachedBlob);
                  setState({
                    loading: false,
                    error: null,
                    refs: fastParsedRefs,
                    resolvedRef: fastResolvedRef,
                    resolvedPath: fastResolvedPath,
                    commitHash: fastCommitHash,
                    headCommit: fastHeadCommit,
                    fileTree: null,
                    parentFileTree: parentEntries,
                    fileContent: content,
                    fileBytes: cachedBlob,
                    isDirectory: false,
                    pathExists: true,
                  });
                  fastHandled = true;
                } else {
                  // Blob not cached yet — render the file list immediately so
                  // the directory sidebar doesn't flash to a skeleton while the
                  // blob is being fetched. File content will be filled in by
                  // the slow path below.
                  setState({
                    loading: false,
                    error: null,
                    refs: fastParsedRefs,
                    resolvedRef: fastResolvedRef,
                    resolvedPath: fastResolvedPath,
                    commitHash: fastCommitHash,
                    headCommit: fastHeadCommit,
                    fileTree: null,
                    parentFileTree: parentEntries,
                    fileContent: null,
                    fileBytes: null,
                    isDirectory: false,
                    pathExists: true,
                  });
                  partialRenderRef.current = true;
                  // Don't set fastHandled — let the slow path fetch the blob.
                }
              }
            }
          }

          // Fast path succeeded — skip the slow path entirely.
          if (fastHandled) return;
        }
      }
    }

    // Only do a full reset if we haven't already rendered partial state from
    // the fast path (e.g. file list shown while blob is still being fetched).
    if (!partialRenderRef.current) {
      setState({
        loading: true,
        error: null,
        refs: [],
        resolvedRef: null,
        resolvedPath: null,
        commitHash: null,
        headCommit: null,
        fileTree: null,
        parentFileTree: null,
        fileContent: null,
        fileBytes: null,
        isDirectory: true,
        pathExists: true,
      });
    }
    partialRenderRef.current = false;

    // -----------------------------------------------------------------------
    // Phase 1: Wait for infoRefs from the pool's observable.
    //
    // The pool is already subscribed (by useGitPool), so the infoRefs fetch
    // is already in flight. We just wait for the observable to emit a state
    // that has infoRefs — no subscribe-briefly trick needed.
    // -----------------------------------------------------------------------
    let info: InfoRefsUploadPackResponse | null = null;

    // Check if infoRefs are already available synchronously.
    info = getInfoRefsFromState(pool, poolState);

    if (!info) {
      // Wait for the pool's observable to emit infoRefs.
      info = await new Promise<InfoRefsUploadPackResponse | null>((resolve) => {
        if (signal.aborted) {
          resolve(null);
          return;
        }

        // BehaviorSubject emits synchronously on subscribe, so the callback
        // may fire before the subscription object is available. We use a
        // resolved flag + deferred unsubscribe to avoid the temporal dead zone.
        let resolved = false;

        const sub = pool.observable.subscribe((state) => {
          if (resolved) return;

          if (signal.aborted) {
            resolved = true;
            resolve(null);
            return;
          }

          const available = getInfoRefsFromState(pool, state);
          if (available) {
            resolved = true;
            resolve(available);
            return;
          }

          // All URLs settled with no infoRefs — give up.
          if (!state.loading && state.health === "all-failed") {
            resolved = true;
            resolve(null);
          }
        });

        // If the callback already resolved synchronously, unsubscribe now.
        if (resolved) {
          sub.unsubscribe();
        }

        signal.addEventListener("abort", () => {
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
          sub.unsubscribe();
        });
      });
    }

    if (signal.aborted) return;

    if (!info) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: "Could not reach any clone URL",
      }));
      return;
    }

    if (signal.aborted) return;

    const parsedRefs = parseRefs(info);
    setState((prev) => ({ ...prev, refs: parsedRefs }));

    // -----------------------------------------------------------------------
    // Resolve which ref/commit to use, and the path within the repo
    // -----------------------------------------------------------------------
    let commitHash: string;
    let resolvedRef: string;
    let path: string;

    if (refAndPath) {
      const resolved = resolveRefAndPath(refAndPath, info);
      if (!resolved) {
        if (signal.aborted) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: `No ref found matching "${refAndPath}"`,
        }));
        return;
      }
      commitHash = resolved.hash;
      resolvedRef = shortRefName(resolved.refPath);
      path = resolved.path;
    } else if (knownHeadCommit) {
      // Use the Nostr state commit as the preferred starting point
      commitHash = knownHeadCommit;
      const matchingRef = parsedRefs.find(
        (r) => r.hash === knownHeadCommit && r.isBranch,
      );
      resolvedRef = matchingRef?.name ?? knownHeadCommit;
      path = "";
    } else {
      // Use the default branch
      const headRef = info.symrefs["HEAD"]; // e.g. "refs/heads/main"
      const defaultRef = parsedRefs.find((r) => r.isDefault && r.isBranch);
      if (!defaultRef) {
        if (signal.aborted) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: "No default branch found",
        }));
        return;
      }
      commitHash = headRef ? info.refs[headRef] : defaultRef.hash;
      resolvedRef = defaultRef.name;
      path = "";
    }

    if (signal.aborted) return;
    setState((prev) => ({
      ...prev,
      resolvedRef,
      resolvedPath: path,
      commitHash,
    }));

    // -----------------------------------------------------------------------
    // Phase 2: Fetch the directory tree via the pool.
    //
    // pool.getTree() checks L1 memory then IDB then fetches from the git
    // server, routes through the winning URL with fallback, and caches the
    // result. The fast-path peeks above read from the same shared L1 maps.
    // -----------------------------------------------------------------------
    const pathSegments = path ? path.split("/").filter(Boolean) : [];
    const nestLimit = pathSegments.length + 1;

    // pool.getTree() checks L1 memory then IDB then fetches — all in one call.
    const tree = await pool.getTree(commitHash, nestLimit, signal);
    if (signal.aborted) return;
    if (!tree) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: "Failed to load file tree",
      }));
      return;
    }

    if (signal.aborted) return;

    // -----------------------------------------------------------------------
    // Navigate to the requested path
    // -----------------------------------------------------------------------
    if (pathSegments.length === 0) {
      const entries = treeToEntries(tree, "");
      setState((prev) => ({
        ...prev,
        loading: false,
        fileTree: entries,
        parentFileTree: null,
        isDirectory: true,
        pathExists: true,
      }));
      fetchHeadCommit(pool, commitHash, signal, setState);
      return;
    }

    // Check if path is a directory
    const subTree = navigateTree(tree, pathSegments);
    if (subTree) {
      const entries = treeToEntries(subTree, path);
      setState((prev) => ({
        ...prev,
        loading: false,
        fileTree: entries,
        parentFileTree: null,
        isDirectory: true,
        pathExists: true,
      }));
      fetchHeadCommit(pool, commitHash, signal, setState);
      return;
    }

    // Compute parent directory entries for file views
    const parentSegments = pathSegments.slice(0, -1);
    const parentPath = parentSegments.join("/");
    const parentTree =
      parentSegments.length === 0 ? tree : navigateTree(tree, parentSegments);
    const parentEntries = parentTree
      ? treeToEntries(parentTree, parentPath)
      : null;

    // Check if path is a file
    const fileHash = findFileInTree(tree, pathSegments);
    if (fileHash) {
      // Check blob cache first (pool.getBlob checks L1 then IDB then fetches)
      const cachedData = await pool.cache.getBlob(fileHash);
      if (cachedData) {
        if (signal.aborted) return;
        const content = new TextDecoder("utf-8", { fatal: false }).decode(
          cachedData,
        );
        setState((prev) => ({
          ...prev,
          loading: false,
          fileTree: null,
          parentFileTree: parentEntries,
          fileContent: content,
          fileBytes: cachedData,
          isDirectory: false,
          pathExists: true,
        }));
        fetchHeadCommit(pool, commitHash, signal, setState);
        return;
      }

      // Fetch the file content via the pool
      const blobData = await pool.getBlob(fileHash, signal);
      if (signal.aborted) return;
      if (blobData) {
        const content = new TextDecoder("utf-8", { fatal: false }).decode(
          blobData,
        );
        setState((prev) => ({
          ...prev,
          loading: false,
          fileTree: null,
          parentFileTree: parentEntries,
          fileContent: content,
          fileBytes: blobData,
          isDirectory: false,
          pathExists: true,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          loading: false,
          fileTree: null,
          parentFileTree: parentEntries,
          fileContent: null,
          fileBytes: null,
          isDirectory: false,
          pathExists: true,
        }));
      }
      fetchHeadCommit(pool, commitHash, signal, setState);
      return;
    }

    // Path not found
    if (signal.aborted) return;
    setState((prev) => ({
      ...prev,
      loading: false,
      pathExists: false,
    }));
  }, [pool, refAndPath, knownHeadCommit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run when the pool changes or when the pool emits infoRefs for the
  // first time (poolState.health transitions away from "idle"/"connecting").
  const prevHealthRef = useRef<string>("idle");
  const hasInfoRefs = pool ? !!getInfoRefsFromState(pool, poolState) : false;
  const prevHasInfoRefs = useRef(false);

  useEffect(() => {
    // Re-run if the pool instance changed.
    const poolChanged = pool !== poolRef.current;
    // Re-run if infoRefs just became available (first data from the network).
    const infoRefsArrived = hasInfoRefs && !prevHasInfoRefs.current;

    poolRef.current = pool;
    prevHasInfoRefs.current = hasInfoRefs;
    prevHealthRef.current = poolState.health;

    if (poolChanged || infoRefsArrived) {
      run();
    }

    return () => {
      abortRef.current?.abort();
    };
  }, [pool, hasInfoRefs, run]); // eslint-disable-line react-hooks/exhaustive-deps

  // Also re-run when refAndPath or knownHeadCommit change (run is stable
  // per useCallback, but its deps include those values).
  useEffect(() => {
    run();
    return () => {
      abortRef.current?.abort();
    };
  }, [run]);

  const reload = useCallback(() => {
    reloadCounterRef.current += 1;
    run();
  }, [run]);

  return { ...state, reload };
}

// ---------------------------------------------------------------------------
// Async helper: fetch head commit metadata (cache-aware, non-blocking)
// ---------------------------------------------------------------------------

async function fetchHeadCommit(
  pool: GitGraspPool,
  commitHash: string,
  signal: AbortSignal,
  setState: React.Dispatch<React.SetStateAction<GitExplorerState>>,
) {
  // Check commit cache first (pool.cache.getCommit checks L1 then IDB)
  const cached = await pool.cache.getCommit(commitHash);
  if (cached) {
    if (!signal.aborted) {
      setState((prev) => ({ ...prev, headCommit: cached }));
    }
    return;
  }

  // Fetch via the pool — routes through the winning URL with fallback
  const commit = await pool.getSingleCommit(commitHash, signal);
  if (signal.aborted || !commit) return;
  setState((prev) => ({ ...prev, headCommit: commit }));
}

// ---------------------------------------------------------------------------
// Commit history hook
// ---------------------------------------------------------------------------

export interface CommitHistoryState {
  loading: boolean;
  error: string | null;
  commits: Commit[];
}

/**
 * Fetches the commit history for a ref via the git-grasp-pool.
 *
 * Accepts a pool instance (from useGitPool) and the current PoolState so it
 * can react to infoRefs becoming available without any extra subscriptions.
 */
export function useCommitHistory(
  pool: GitGraspPool | null,
  poolState: PoolState,
  ref: string | undefined,
  maxCommits: number = 50,
): CommitHistoryState {
  const [state, setState] = useState<CommitHistoryState>(() => {
    // Fast path: check L1 cache synchronously on first render.
    if (ref && pool) {
      const fastInfo = pool.getInfoRefs();
      if (fastInfo) {
        const commitHash = ref.startsWith("refs/")
          ? fastInfo.refs[ref]
          : (fastInfo.refs[`refs/heads/${ref}`] ??
            fastInfo.refs[`refs/tags/${ref}`] ??
            ref);
        if (commitHash) {
          const cached = pool.cache.peekCommitHistory(commitHash, maxCommits);
          if (cached) return { loading: false, error: null, commits: cached };
        }
      }
    }
    return { loading: false, error: null, commits: [] };
  });

  const hasInfoRefs = pool ? !!pool.getInfoRefs() : false;

  useEffect(() => {
    if (!pool || !ref) return;

    const abort = new AbortController();
    const signal = abort.signal;

    async function run() {
      if (!pool || !ref) return;

      // Wait for infoRefs if not yet available.
      let info = pool.getInfoRefs();
      if (!info) {
        info = await new Promise<InfoRefsUploadPackResponse | null>(
          (resolve) => {
            if (signal.aborted) {
              resolve(null);
              return;
            }
            const sub = pool!.observable.subscribe((s) => {
              if (signal.aborted) {
                sub.unsubscribe();
                resolve(null);
                return;
              }
              const available =
                pool!.getInfoRefs() ??
                Object.values(s.urls).find((u) => u.infoRefs)?.infoRefs ??
                null;
              if (available) {
                sub.unsubscribe();
                resolve(available);
                return;
              }
              if (!s.loading && s.health === "all-failed") {
                sub.unsubscribe();
                resolve(null);
              }
            });
            signal.addEventListener("abort", () => {
              sub.unsubscribe();
              resolve(null);
            });
          },
        );
      }

      if (signal.aborted || !info) {
        if (!signal.aborted) {
          setState({
            loading: false,
            error: "Could not reach any clone URL",
            commits: [],
          });
        }
        return;
      }

      // Resolve ref to commit hash.
      const commitHash = ref.startsWith("refs/")
        ? info.refs[ref]
        : (info.refs[`refs/heads/${ref}`] ??
          info.refs[`refs/tags/${ref}`] ??
          ref);

      if (!commitHash) {
        setState({
          loading: false,
          error: `Ref "${ref}" not found`,
          commits: [],
        });
        return;
      }

      // Check history cache (L1 then IDB).
      const cachedHistory = await pool.cache.getCommitHistory(
        commitHash,
        maxCommits,
      );
      if (cachedHistory) {
        setState({ loading: false, error: null, commits: cachedHistory });
        return;
      }

      setState({ loading: true, error: null, commits: [] });

      const commits = await pool.getCommitHistory(
        commitHash,
        maxCommits,
        signal,
      );
      if (signal.aborted) return;

      if (!commits || commits.length === 0) {
        setState({ loading: false, error: "No commits found", commits: [] });
        return;
      }

      setState({ loading: false, error: null, commits });
    }

    void run();
    return () => abort.abort();
  }, [pool, ref, maxCommits, hasInfoRefs]);

  return state;
}
