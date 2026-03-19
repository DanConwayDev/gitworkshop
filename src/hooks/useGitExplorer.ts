import { useState, useEffect, useRef, useCallback } from "react";
import {
  getInfoRefs,
  getDirectoryTreeAt,
  getObject,
  fetchCommitsOnly,
  type Commit,
  type Tree,
  type InfoRefsUploadPackResponse,
} from "@fiatjaf/git-natural-api";
import {
  getCachedInfoRefs,
  cacheInfoRefs,
  peekCachedInfoRefsStale,
  getCachedBlob,
  cacheBlob,
  peekCachedBlob,
  getCachedCommit,
  cacheCommit,
  peekCachedCommit,
  getCachedTree,
  cacheTree,
  getCachedCommitHistory,
  cacheCommitHistory,
} from "@/services/gitObjectCache";

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
  /** The resolved ref name being viewed (e.g. "main") */
  resolvedRef: string | null;
  /** The commit hash for the current ref */
  commitHash: string | null;
  /** The latest commit on the current ref */
  headCommit: Commit | null;
  /** File/directory entries for the current path */
  fileTree: FileEntry[] | null;
  /** Content of the currently viewed file (if path is a file) */
  fileContent: string | null;
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
 * Resolve a user-supplied ref string to a full refs/ path.
 * Accepts: bare branch name, "refs/heads/...", "refs/tags/...", commit hash.
 */
function resolveRefString(
  ref: string,
  info: InfoRefsUploadPackResponse,
): { refPath: string; hash: string } | undefined {
  // Already a full ref path
  if (ref.startsWith("refs/")) {
    const hash = info.refs[ref];
    if (hash) return { refPath: ref, hash };
    return undefined;
  }

  // Try as branch name
  const branchPath = `refs/heads/${ref}`;
  if (info.refs[branchPath]) {
    return { refPath: branchPath, hash: info.refs[branchPath] };
  }

  // Try as tag name
  const tagPath = `refs/tags/${ref}`;
  if (info.refs[tagPath]) {
    return { refPath: tagPath, hash: info.refs[tagPath] };
  }

  // Try as commit hash (40-char hex)
  if (/^[0-9a-f]{40}$/i.test(ref)) {
    return { refPath: ref, hash: ref };
  }

  return undefined;
}

/**
 * Fetch infoRefs for a URL, checking the object cache first.
 */
async function fetchInfoRefsCached(
  url: string,
  signal: AbortSignal,
): Promise<InfoRefsUploadPackResponse> {
  const cached = await getCachedInfoRefs(url);
  if (cached) return cached;
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const info = await getInfoRefs(url);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  cacheInfoRefs(url, info);
  return info;
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export interface UseGitExplorerOptions {
  /**
   * The ref to view (branch name, tag name, or commit hash).
   * If undefined, uses the default branch from getInfoRefs.
   */
  ref?: string;
  /**
   * The file/directory path within the repo to view.
   * Empty string or undefined = repo root.
   */
  path?: string;
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
  const { ref, path = "", knownHeadCommit } = options;

  const [state, setState] = useState<GitExplorerState>({
    loading: false,
    error: null,
    refs: [],
    resolvedRef: null,
    commitHash: null,
    headCommit: null,
    fileTree: null,
    fileContent: null,
    isDirectory: true,
    pathExists: true,
  });

  const urlsKey = cloneUrls.join(",");
  const abortRef = useRef<AbortController | null>(null);
  const reloadCounterRef = useRef(0);

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
    const pathSegments = path ? path.split("/").filter(Boolean) : [];
    const nestLimit = pathSegments.length + 1;

    const fastInfo = cloneUrls
      .map((u) => ({ url: u, info: peekCachedInfoRefsStale(u) }))
      .find((r) => r.info !== undefined) as
      | { url: string; info: InfoRefsUploadPackResponse }
      | undefined;

    if (fastInfo) {
      const fastParsedRefs = parseRefs(fastInfo.info);
      let fastCommitHash: string | undefined;
      let fastResolvedRef: string | undefined;

      if (ref) {
        const resolved = resolveRefString(ref, fastInfo.info);
        if (resolved) {
          fastCommitHash = resolved.hash;
          fastResolvedRef = resolved.refPath.startsWith("refs/heads/")
            ? resolved.refPath.replace("refs/heads/", "")
            : resolved.refPath.startsWith("refs/tags/")
              ? resolved.refPath.replace("refs/tags/", "")
              : resolved.refPath;
        }
      } else if (knownHeadCommit) {
        fastCommitHash = knownHeadCommit;
        const matchingRef = fastParsedRefs.find(
          (r) => r.hash === knownHeadCommit && r.isBranch,
        );
        fastResolvedRef = matchingRef?.name ?? knownHeadCommit.slice(0, 8);
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
        }
      }

      if (fastCommitHash && fastResolvedRef) {
        const fastTree = getCachedTree(fastCommitHash, nestLimit);
        if (fastTree) {
          // Tree is in memory — attempt a fully-synchronous render.
          const fastHeadCommit = peekCachedCommit(fastCommitHash) ?? null;
          let fastHandled = false;

          if (pathSegments.length === 0) {
            setState({
              loading: false,
              error: null,
              refs: fastParsedRefs,
              resolvedRef: fastResolvedRef,
              commitHash: fastCommitHash,
              headCommit: fastHeadCommit,
              fileTree: treeToEntries(fastTree, ""),
              fileContent: null,
              isDirectory: true,
              pathExists: true,
            });
            fastHandled = true;
          } else {
            const subTree = navigateTree(fastTree, pathSegments);
            if (subTree) {
              setState({
                loading: false,
                error: null,
                refs: fastParsedRefs,
                resolvedRef: fastResolvedRef,
                commitHash: fastCommitHash,
                headCommit: fastHeadCommit,
                fileTree: treeToEntries(subTree, path),
                fileContent: null,
                isDirectory: true,
                pathExists: true,
              });
              fastHandled = true;
            } else {
              const fileHash = findFileInTree(fastTree, pathSegments);
              if (fileHash) {
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
                    commitHash: fastCommitHash,
                    headCommit: fastHeadCommit,
                    fileTree: null,
                    fileContent: content,
                    isDirectory: false,
                    pathExists: true,
                  });
                  fastHandled = true;
                }
              }
            }
          }

          // Fast path succeeded — skip the slow path entirely.
          if (fastHandled) return;
        }
      }
    }

    setState({
      loading: true,
      error: null,
      refs: [],
      resolvedRef: null,
      commitHash: null,
      headCommit: null,
      fileTree: null,
      fileContent: null,
      isDirectory: true,
      pathExists: true,
    });

    // -----------------------------------------------------------------------
    // Phase 1: Race getInfoRefs across all URLs (cache-aware)
    // -----------------------------------------------------------------------
    let info: InfoRefsUploadPackResponse | undefined;
    let winningUrl: string | undefined;

    try {
      const result = await Promise.any(
        cloneUrls.map(async (url) => {
          const i = await fetchInfoRefsCached(url, signal);
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
    // Resolve which ref/commit to use
    // -----------------------------------------------------------------------
    let commitHash: string;
    let resolvedRef: string;

    if (ref) {
      const resolved = resolveRefString(ref, info);
      if (!resolved) {
        if (signal.aborted) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: `Ref "${ref}" not found`,
        }));
        return;
      }
      commitHash = resolved.hash;
      resolvedRef = resolved.refPath.startsWith("refs/heads/")
        ? resolved.refPath.replace("refs/heads/", "")
        : resolved.refPath.startsWith("refs/tags/")
          ? resolved.refPath.replace("refs/tags/", "")
          : resolved.refPath;
    } else if (knownHeadCommit) {
      // Use the Nostr state commit as the preferred starting point
      commitHash = knownHeadCommit;
      // Find the branch name for this commit
      const matchingRef = parsedRefs.find(
        (r) => r.hash === knownHeadCommit && r.isBranch,
      );
      resolvedRef = matchingRef?.name ?? knownHeadCommit.slice(0, 8);
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
    }

    if (signal.aborted) return;
    setState((prev) => ({ ...prev, resolvedRef, commitHash }));

    // -----------------------------------------------------------------------
    // Phase 2: Fetch the directory tree (depth = path depth + 1 for listing)
    // pathSegments / nestLimit already declared in the fast-path block above.
    // -----------------------------------------------------------------------

    let tree: Tree;

    const cachedTree = getCachedTree(commitHash, nestLimit);
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
            getDirectoryTreeAt(url, commitHash, nestLimit),
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
        isDirectory: true,
        pathExists: true,
      }));
      fetchHeadCommit(cloneUrls, commitHash, signal, setState);
      return;
    }

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
          fileContent: content,
          isDirectory: false,
          pathExists: true,
        }));
        fetchHeadCommit(cloneUrls, commitHash, signal, setState);
        return;
      }

      // Fetch the file content from git servers
      try {
        const obj = await Promise.any(
          cloneUrls.map((url) => getObject(url, fileHash)),
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
            fileContent: content,
            isDirectory: false,
            pathExists: true,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            loading: false,
            fileContent: null,
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
  }, [urlsKey, ref, path, knownHeadCommit]); // eslint-disable-line react-hooks/exhaustive-deps

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
      cloneUrls.map((url) => fetchCommitsOnly(url, commitHash, 1)),
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
          const cached = getCachedCommitHistory(commitHash, maxCommits);
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
    Promise.any(cloneUrls.map((url) => fetchInfoRefsCached(url, signal)))
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
        const cachedHistory = getCachedCommitHistory(commitHash, maxCommits);
        if (cachedHistory) {
          setState({ loading: false, error: null, commits: cachedHistory });
          return;
        }

        setState({ loading: true, error: null, commits: [] });

        const commits = await Promise.any(
          cloneUrls.map((url) => fetchCommitsOnly(url, commitHash, maxCommits)),
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
