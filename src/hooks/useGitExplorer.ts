import { useState, useEffect, useRef, useCallback } from "react";
import {
  getDirectoryTreeAt,
  getObject,
  fetchCommitsOnly,
  type Commit,
  type Tree,
  type InfoRefsUploadPackResponse,
} from "@fiatjaf/git-natural-api";
import {
  peekCachedInfoRefsStale,
  getCachedBlob,
  cacheBlob,
  peekCachedBlob,
  getCachedCommit,
  cacheCommit,
  peekCachedCommit,
  getCachedTree,
  peekCachedTree,
  cacheTree,
  getCachedCommitHistory,
  peekCachedCommitHistory,
  cacheCommitHistory,
} from "@/services/gitObjectCache";
import { resolveGitUrl } from "@/lib/corsProxy";
import { fetchInfoRefs } from "@/services/gitRepoDataService";

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

/**
 * Fetch infoRefs for a URL, checking the object cache first.
 * Automatically falls back to the CORS proxy on CORS-like errors.
 * The cache key is always the original URL so callers stay unaware of the proxy.
 */

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
 * Fetches the git file tree and file content for a repository path,
 * racing all clone URLs in parallel and using the first successful response.
 *
 * Uses git-natural-api (HTTP-based, no local clone required).
 * Leverages gitObjectCache for content-addressed caching of commits and blobs.
 * Shares infoRefs results with gitRepoDataService via the same cache layer.
 */
export function useGitExplorer(
  cloneUrls: string[],
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

  const urlsKey = cloneUrls.join(",");
  const abortRef = useRef<AbortController | null>(null);
  const reloadCounterRef = useRef(0);
  /** True when the fast path has rendered partial state (file list without blob). */
  const partialRenderRef = useRef(false);

  const run = useCallback(async () => {
    if (cloneUrls.length === 0) return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const signal = abort.signal;

    // -----------------------------------------------------------------------
    // Fast path: if infoRefs + tree are already in the L1 memory cache we can
    // render immediately without a loading flash.  This is the common case on
    // remount (tab switch, navigation back).
    // -----------------------------------------------------------------------
    const fastInfo = cloneUrls
      .map((u) => ({ url: u, info: peekCachedInfoRefsStale(u) }))
      .find((r) => r.info !== undefined) as
      | { url: string; info: InfoRefsUploadPackResponse }
      | undefined;

    if (fastInfo) {
      const fastParsedRefs = parseRefs(fastInfo.info);
      let fastCommitHash: string | undefined;
      let fastResolvedRef: string | undefined;
      let fastResolvedPath: string | undefined;

      if (refAndPath) {
        const resolved = resolveRefAndPath(refAndPath, fastInfo.info);
        if (resolved) {
          fastCommitHash = resolved.hash;
          fastResolvedRef = resolved.refPath.startsWith("refs/heads/")
            ? resolved.refPath.replace("refs/heads/", "")
            : resolved.refPath.startsWith("refs/tags/")
              ? resolved.refPath.replace("refs/tags/", "")
              : resolved.refPath;
          fastResolvedPath = resolved.path;
        }
      } else if (knownHeadCommit) {
        fastCommitHash = knownHeadCommit;
        const matchingRef = fastParsedRefs.find(
          (r) => r.hash === knownHeadCommit && r.isBranch,
        );
        fastResolvedRef = matchingRef?.name ?? knownHeadCommit.slice(0, 8);
        fastResolvedPath = "";
      } else {
        const headRef = fastInfo.info.symrefs["HEAD"];
        const defaultRef = fastParsedRefs.find(
          (r) => r.isDefault && r.isBranch,
        );
        if (defaultRef) {
          fastCommitHash = headRef
            ? fastInfo.info.refs[headRef]
            : defaultRef.hash;
          fastResolvedRef = defaultRef.name;
          fastResolvedPath = "";
        }
      }

      if (fastCommitHash && fastResolvedRef && fastResolvedPath !== undefined) {
        const fastPathSegments = fastResolvedPath
          ? fastResolvedPath.split("/").filter(Boolean)
          : [];
        const fastNestLimit = fastPathSegments.length + 1;
        const fastTree = peekCachedTree(fastCommitHash, fastNestLimit);
        if (fastTree) {
          // Tree is in memory — attempt a fully-synchronous render.
          const fastHeadCommit = peekCachedCommit(fastCommitHash) ?? null;
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

                const cachedBlob = peekCachedBlob(fileHash);
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
    // Phase 1: Race getInfoRefs across all URLs (cache-aware)
    // -----------------------------------------------------------------------
    let info: InfoRefsUploadPackResponse | undefined;
    let winningUrl: string | undefined;

    try {
      const result = await Promise.any(
        cloneUrls.map(async (url) => {
          const i = await fetchInfoRefs(url, signal);
          return { url, info: i };
        }),
      );
      if (signal.aborted) return;
      info = result.info;
      winningUrl = result.url;
    } catch {
      if (signal.aborted) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: "Could not reach any clone URL",
      }));
      return;
    }

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
      resolvedRef = resolved.refPath.startsWith("refs/heads/")
        ? resolved.refPath.replace("refs/heads/", "")
        : resolved.refPath.startsWith("refs/tags/")
          ? resolved.refPath.replace("refs/tags/", "")
          : resolved.refPath;
      path = resolved.path;
    } else if (knownHeadCommit) {
      // Use the Nostr state commit as the preferred starting point
      commitHash = knownHeadCommit;
      const matchingRef = parsedRefs.find(
        (r) => r.hash === knownHeadCommit && r.isBranch,
      );
      resolvedRef = matchingRef?.name ?? knownHeadCommit.slice(0, 8);
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
    // Phase 2: Fetch the directory tree (depth = path depth + 1 for listing)
    // -----------------------------------------------------------------------
    const pathSegments = path ? path.split("/").filter(Boolean) : [];
    const nestLimit = pathSegments.length + 1;

    let tree: Tree;

    const cachedTree = await getCachedTree(commitHash, nestLimit);
    if (cachedTree) {
      tree = cachedTree;
    } else {
      try {
        const urlsToTry = [
          winningUrl,
          ...cloneUrls.filter((u) => u !== winningUrl),
        ];

        tree = await Promise.any(
          urlsToTry.map((url) =>
            getDirectoryTreeAt(resolveGitUrl(url), commitHash, nestLimit),
          ),
        );
        cacheTree(commitHash, nestLimit, tree);
      } catch (err) {
        if (signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          loading: false,
          error: `Failed to load file tree: ${msg}`,
        }));
        return;
      }
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
      fetchHeadCommit(cloneUrls, commitHash, signal, setState);
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
      fetchHeadCommit(cloneUrls, commitHash, signal, setState);
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
      // Check blob cache first
      const cachedData = await getCachedBlob(fileHash);
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
        fetchHeadCommit(cloneUrls, commitHash, signal, setState);
        return;
      }

      // Fetch the file content from git servers
      try {
        const obj = await Promise.any(
          cloneUrls.map((url) => getObject(resolveGitUrl(url), fileHash)),
        );
        if (signal.aborted) return;
        if (obj) {
          cacheBlob(fileHash, obj.data);
          const content = new TextDecoder("utf-8", { fatal: false }).decode(
            obj.data,
          );
          setState((prev) => ({
            ...prev,
            loading: false,
            fileTree: null,
            parentFileTree: parentEntries,
            fileContent: content,
            fileBytes: obj.data,
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
      } catch {
        if (signal.aborted) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: "Failed to load file content",
          isDirectory: false,
          pathExists: true,
        }));
      }
      fetchHeadCommit(cloneUrls, commitHash, signal, setState);
      return;
    }

    // Path not found
    if (signal.aborted) return;
    setState((prev) => ({
      ...prev,
      loading: false,
      pathExists: false,
    }));
  }, [urlsKey, refAndPath, knownHeadCommit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    run();
    return () => {
      abortRef.current?.abort();
    };
  }, [run, reloadCounterRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

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
  cloneUrls: string[],
  commitHash: string,
  signal: AbortSignal,
  setState: React.Dispatch<React.SetStateAction<GitExplorerState>>,
) {
  // Check commit cache first
  const cached = await getCachedCommit(commitHash);
  if (cached) {
    if (!signal.aborted) {
      setState((prev) => ({ ...prev, headCommit: cached }));
    }
    return;
  }

  try {
    const commits = await Promise.any(
      cloneUrls.map((url) =>
        fetchCommitsOnly(resolveGitUrl(url), commitHash, 1),
      ),
    );
    if (signal.aborted) return;
    if (commits.length > 0) {
      cacheCommit(commits[0]);
      setState((prev) => ({ ...prev, headCommit: commits[0] }));
    }
  } catch {
    // Non-critical — just don't show commit info
  }
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
 * Fetches the commit history for a ref, racing all clone URLs.
 */
export function useCommitHistory(
  cloneUrls: string[],
  ref: string | undefined,
  maxCommits: number = 50,
): CommitHistoryState {
  const [state, setState] = useState<CommitHistoryState>(() => {
    // Fast path: resolve commitHash from stale infoRefs and check history cache
    if (ref && cloneUrls.length > 0) {
      const fastInfo = cloneUrls
        .map((u) => peekCachedInfoRefsStale(u))
        .find((i) => i !== undefined);
      if (fastInfo) {
        const commitHash = ref.startsWith("refs/")
          ? fastInfo.refs[ref]
          : (fastInfo.refs[`refs/heads/${ref}`] ??
            fastInfo.refs[`refs/tags/${ref}`] ??
            ref);
        if (commitHash) {
          const cached = peekCachedCommitHistory(commitHash, maxCommits);
          if (cached) return { loading: false, error: null, commits: cached };
        }
      }
    }
    return { loading: false, error: null, commits: [] };
  });

  const urlsKey = cloneUrls.join(",");

  useEffect(() => {
    if (cloneUrls.length === 0 || !ref) return;

    const abort = new AbortController();
    const signal = abort.signal;

    // First resolve the ref to a commit hash via getInfoRefs (cache-aware)
    Promise.any(cloneUrls.map((url) => fetchInfoRefs(url, signal)))
      .then(async (info) => {
        if (signal.aborted) return;

        // Resolve ref to commit hash
        let commitHash: string;
        if (ref.startsWith("refs/")) {
          commitHash = info.refs[ref];
        } else {
          commitHash =
            info.refs[`refs/heads/${ref}`] ??
            info.refs[`refs/tags/${ref}`] ??
            ref; // treat as commit hash
        }

        if (!commitHash) {
          setState({
            loading: false,
            error: `Ref "${ref}" not found`,
            commits: [],
          });
          return;
        }

        // Check history cache before hitting the network
        const cachedHistory = await getCachedCommitHistory(
          commitHash,
          maxCommits,
        );
        if (cachedHistory) {
          setState({ loading: false, error: null, commits: cachedHistory });
          return;
        }

        setState({ loading: true, error: null, commits: [] });

        const commits = await Promise.any(
          cloneUrls.map((url) =>
            fetchCommitsOnly(resolveGitUrl(url), commitHash, maxCommits),
          ),
        );

        if (signal.aborted) return;

        // Cache each individual commit and the full history list
        for (const commit of commits) {
          cacheCommit(commit);
        }

        // Sort newest first
        const sorted = [...commits].sort(
          (a, b) =>
            (b.committer?.timestamp ?? b.author.timestamp) -
            (a.committer?.timestamp ?? a.author.timestamp),
        );

        cacheCommitHistory(commitHash, maxCommits, sorted);
        setState({ loading: false, error: null, commits: sorted });
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ loading: false, error: msg, commits: [] });
      });

    return () => abort.abort();
  }, [urlsKey, ref, maxCommits]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
