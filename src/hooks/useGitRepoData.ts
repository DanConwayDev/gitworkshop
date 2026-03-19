import { useState, useEffect, useRef } from "react";
import {
  getInfoRefs,
  getObject,
  getObjectByPath,
  fetchCommitsOnly,
  shallowCloneRepositoryAt,
  type Commit,
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

/**
 * Race all clone URLs in parallel: whichever responds to getInfoRefs first
 * wins, and all subsequent fetches use that URL.
 *
 * On filter-capable servers the README and commit are fetched in parallel:
 * - README: race all candidate filenames via getObjectByPath + getObject
 *   (first hit wins, all candidates run simultaneously)
 * - Commit: fetchCommitsOnly with tree:0 filter
 *
 * On non-filter servers we fall back to shallowCloneRepositoryAt which
 * returns both in one round-trip.
 */
async function fetchFromFastestUrl(
  cloneUrls: string[],
  signal: AbortSignal,
): Promise<{
  latestCommit: Commit;
  readmeContent: string | null;
  readmeFilename: string | null;
}> {
  // Race getInfoRefs across all URLs simultaneously.
  // Promise.any rejects only when every promise rejects (AggregateError).
  const { url, info } = await Promise.any(
    cloneUrls.map(async (url) => {
      const info = await getInfoRefs(url);
      return { url, info };
    }),
  );

  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const headRef = info.symrefs["HEAD"];
  const headCommit = headRef ? info.refs[headRef] : Object.values(info.refs)[0];

  if (!headCommit) {
    throw new Error(`No HEAD commit found at ${url}`);
  }

  const supportsFilter = info.capabilities.includes("filter");

  if (supportsFilter) {
    // Optimistic path: fetch commit metadata and README blob in parallel.
    // For the README we race all candidate filenames simultaneously — each
    // candidate resolves the path to a blob hash then fetches the blob.
    // Promise.any takes the first hit; if none exist we get null.
    const [commits, readmeResult] = await Promise.all([
      fetchCommitsOnly(url, headCommit, 1),
      Promise.any(
        README_NAMES.map(async (name) => {
          const entry = await getObjectByPath(url, headCommit, name);
          if (!entry || entry.isDir) throw new Error(`${name} not found`);
          const obj = await getObject(url, entry.hash);
          if (!obj) throw new Error(`${name} blob missing`);
          return { name, content: new TextDecoder("utf-8").decode(obj.data) };
        }),
      ).catch(() => null), // all candidates missing → null
    ]);

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    return {
      latestCommit: commits[0],
      readmeContent: readmeResult?.content ?? null,
      readmeFilename: readmeResult?.name ?? null,
    };
  } else {
    // Fallback: shallow clone returns commit + blobs in one round-trip
    const result = await shallowCloneRepositoryAt(url, headCommit);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    let readmeContent: string | null = null;
    let readmeFilename: string | null = null;

    for (const name of README_NAMES) {
      const file = result.tree.files.find((f) => f.name === name);
      if (file?.content) {
        readmeFilename = file.name;
        readmeContent = new TextDecoder("utf-8").decode(file.content);
        break;
      }
    }

    return {
      latestCommit: result.commit,
      readmeContent,
      readmeFilename,
    };
  }
}

/**
 * Fetches the directory tree, latest commit, and README content by racing
 * all clone URLs in parallel and using whichever responds first.
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

    fetchFromFastestUrl(cloneUrls, abort.signal)
      .then(({ latestCommit, readmeContent, readmeFilename }) => {
        if (!abort.signal.aborted) {
          setState({
            loading: false,
            error: null,
            latestCommit,
            readmeContent,
            readmeFilename,
          });
        }
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        const message =
          err instanceof AggregateError
            ? "Could not reach any clone URL"
            : err instanceof Error
              ? err.message
              : String(err);
        setState({
          loading: false,
          error: message,
          latestCommit: null,
          readmeContent: null,
          readmeFilename: null,
        });
      });

    return () => {
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  return state;
}
