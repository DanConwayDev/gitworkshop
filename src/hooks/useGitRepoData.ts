import { useState, useEffect, useRef } from "react";
import {
  getInfoRefs,
  getDirectoryTreeAt,
  fetchCommitsOnly,
  shallowCloneRepositoryAt,
  getObject,
  type Commit,
  type Tree,
} from "@fiatjaf/git-natural-api";

export interface GitRepoData {
  loading: boolean;
  error: string | null;
  latestCommit: Commit | null;
  readmeContent: string | null;
  readmeFilename: string | null;
}

/** README filenames to look for, in priority order */
const README_NAMES = [
  "README.md",
  "readme.md",
  "README.markdown",
  "README",
  "readme",
  "README.txt",
  "readme.txt",
];

/** Find a README file entry in the root of a tree */
function findReadme(tree: Tree): { name: string; hash: string } | undefined {
  for (const name of README_NAMES) {
    const file = tree.files.find((f) => f.name === name);
    if (file) return { name: file.name, hash: file.hash };
  }
  return undefined;
}

/**
 * Fetches the directory tree, latest commit, and README content from the
 * first reachable clone URL. Tries filter-capable servers first (more
 * efficient), falling back to shallowCloneRepositoryAt.
 */
export function useGitRepoData(cloneUrls: string[]): GitRepoData {
  const [state, setState] = useState<GitRepoData>({
    loading: false,
    error: null,
    latestCommit: null,
    readmeContent: null,
    readmeFilename: null,
  });

  // Track the last set of clone URLs so we don't re-fetch unnecessarily
  const urlsKey = cloneUrls.join(",");
  const prevUrlsKey = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (cloneUrls.length === 0) return;
    if (urlsKey === prevUrlsKey.current) return;
    prevUrlsKey.current = urlsKey;

    // Cancel any in-flight fetch
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setState({
      loading: true,
      error: null,
      latestCommit: null,
      readmeContent: null,
      readmeFilename: null,
    });

    (async () => {
      let lastError: string | null = null;

      for (const url of cloneUrls) {
        if (abort.signal.aborted) return;

        try {
          // Probe the server to find HEAD and check capabilities
          const info = await getInfoRefs(url);
          if (abort.signal.aborted) return;

          const headRef = info.symrefs["HEAD"];
          const headCommit = headRef
            ? info.refs[headRef]
            : Object.values(info.refs)[0];

          if (!headCommit) {
            lastError = `No HEAD commit found at ${url}`;
            continue;
          }

          const supportsFilter = info.capabilities.includes("filter");

          let tree: Tree;
          let latestCommit: Commit;

          if (supportsFilter) {
            // Efficient path: fetch tree and commits separately
            const [treeResult, commits] = await Promise.all([
              getDirectoryTreeAt(url, headCommit),
              fetchCommitsOnly(url, headCommit, 1),
            ]);
            if (abort.signal.aborted) return;
            tree = treeResult;
            latestCommit = commits[0];
          } else {
            // Fallback: shallow clone (fetches blobs too, less efficient)
            const result = await shallowCloneRepositoryAt(url, headCommit);
            if (abort.signal.aborted) return;
            tree = result.tree;
            latestCommit = result.commit;
          }

          // Find and fetch README
          let readmeContent: string | null = null;
          let readmeFilename: string | null = null;
          const readme = findReadme(tree);

          if (readme) {
            readmeFilename = readme.name;
            // If the content is already in the tree (shallow clone path), use it
            const treeFile = tree.files.find((f) => f.name === readme.name);
            if (treeFile?.content) {
              readmeContent = new TextDecoder("utf-8").decode(treeFile.content);
            } else {
              // Fetch the blob separately (filter path)
              try {
                const obj = await getObject(url, readme.hash);
                if (abort.signal.aborted) return;
                if (obj) {
                  readmeContent = new TextDecoder("utf-8").decode(obj.data);
                }
              } catch {
                // README fetch failed — show tree without README
              }
            }
          }

          if (!abort.signal.aborted) {
            setState({
              loading: false,
              error: null,
              latestCommit,
              readmeContent,
              readmeFilename,
            });
          }
          return;
        } catch (err) {
          if (abort.signal.aborted) return;
          lastError = err instanceof Error ? err.message : String(err);
          // Try next URL
        }
      }

      // All URLs failed
      if (!abort.signal.aborted) {
        setState({
          loading: false,
          error: lastError ?? "Could not reach any clone URL",
          latestCommit: null,
          readmeContent: null,
          readmeFilename: null,
        });
      }
    })();

    return () => {
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  return state;
}
