import { useState, useEffect, useRef } from "react";
import {
  getInfoRefs,
  getObject,
  getObjectByPath,
  fetchCommitsOnly,
  shallowCloneRepositoryAt,
  type Commit,
  type InfoRefsUploadPackResponse,
} from "@fiatjaf/git-natural-api";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of getInfoRefs for a single clone URL, or an error. */
export type UrlInfoRefsResult =
  | {
      status: "ok";
      headCommit: string;
      headRef: string | undefined;
      info: InfoRefsUploadPackResponse;
    }
  | { status: "error"; error: string };

/**
 * Warning to surface in the UI when the displayed commit differs from what
 * the state event or git servers declare.
 */
export type GitRepoWarning =
  /** State event HEAD commit could not be fetched from any git server. */
  | { kind: "state-commit-unavailable"; stateCommitId: string }
  /** Git servers report a newer HEAD than the state event. */
  | {
      kind: "state-behind-git";
      stateCommitId: string;
      gitCommitId: string;
      stateCreatedAt: number;
      gitCommitterDate: number;
    };

export interface GitRepoData {
  loading: boolean;
  error: string | null;
  latestCommit: Commit | null;
  readmeContent: string | null;
  readmeFilename: string | null;
  /** Per-URL results from getInfoRefs, populated as each URL resolves. */
  urlInfoRefs: Record<string, UrlInfoRefsResult>;
  /** Warning to display, if any. */
  warning: GitRepoWarning | null;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A fetched commit + README result for a specific commit hash. */
interface CommitResult {
  commit: Commit;
  readmeContent: string | null;
  readmeFilename: string | null;
  /** The clone URL that successfully served this result. */
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch commit metadata and README for a specific commit hash from a single
 * URL. Returns null if the commit cannot be found on that server.
 */
async function fetchCommitData(
  url: string,
  commitHash: string,
  supportsFilter: boolean,
  signal: AbortSignal,
): Promise<CommitResult | null> {
  try {
    if (supportsFilter) {
      const [commits, readmeResult] = await Promise.all([
        fetchCommitsOnly(url, commitHash, 1),
        Promise.any(
          README_NAMES.map(async (name) => {
            const entry = await getObjectByPath(url, commitHash, name);
            if (!entry || entry.isDir) throw new Error(`${name} not found`);
            const obj = await getObject(url, entry.hash);
            if (!obj) throw new Error(`${name} blob missing`);
            return { name, content: new TextDecoder("utf-8").decode(obj.data) };
          }),
        ).catch(() => null),
      ]);

      if (signal.aborted) return null;
      if (!commits || commits.length === 0) return null;

      return {
        commit: commits[0],
        readmeContent: readmeResult?.content ?? null,
        readmeFilename: readmeResult?.name ?? null,
        sourceUrl: url,
      };
    } else {
      const result = await shallowCloneRepositoryAt(url, commitHash);
      if (signal.aborted) return null;

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
        commit: result.commit,
        readmeContent,
        readmeFilename,
        sourceUrl: url,
      };
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export interface UseGitRepoDataOptions {
  /**
   * The HEAD commit ID declared by the authoritative state event (kind:30618).
   * When provided the hook immediately starts fetching this commit's data in
   * parallel with the getInfoRefs race, potentially skipping Phase 1 entirely.
   */
  knownHeadCommit?: string;
  /**
   * The created_at timestamp (seconds) of the state event that declared
   * knownHeadCommit. Used in the heuristic to decide which commit to display.
   */
  stateCreatedAt?: number;
}

/**
 * Fetches the latest commit and README for a repository by racing all clone
 * URLs in parallel.
 *
 * Two-phase fetch with optional Phase 1 shortcut:
 *
 * Phase 1 (shortcut): If `knownHeadCommit` is provided, immediately start
 *   fetching that commit's data across all clone URLs in parallel with the
 *   getInfoRefs race. The first URL to serve the state commit wins Phase 1.
 *
 * Phase 1 (normal): Race all clone URLs with getInfoRefs. Whichever responds
 *   first provides the HEAD commit hash and filter capability flag.
 *
 * Phase 2: For each URL whose getInfoRefs reports a HEAD different from
 *   knownHeadCommit, fetch that commit's data too. Apply the heuristic
 *   (state created_at vs committer date) to decide what to display.
 *
 * README updates: the first README to arrive is shown immediately. If a
 *   newer commit's README arrives later it silently replaces the current one.
 */
export function useGitRepoData(
  cloneUrls: string[],
  options: UseGitRepoDataOptions = {},
): GitRepoData {
  const { knownHeadCommit, stateCreatedAt } = options;

  const [state, setState] = useState<GitRepoData>({
    loading: false,
    error: null,
    latestCommit: null,
    readmeContent: null,
    readmeFilename: null,
    urlInfoRefs: {},
    warning: null,
  });

  const urlsKey = cloneUrls.join(",");
  const prevUrlsKey = useRef<string>("");
  const prevKnownHead = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (cloneUrls.length === 0) return;

    // Re-run when URLs change OR when we get a knownHeadCommit for the first
    // time (state event arrived after the initial fetch started).
    const headChanged =
      knownHeadCommit !== undefined &&
      knownHeadCommit !== prevKnownHead.current;
    const urlsChanged = urlsKey !== prevUrlsKey.current;

    if (!urlsChanged && !headChanged) return;

    prevUrlsKey.current = urlsKey;
    prevKnownHead.current = knownHeadCommit;

    // Cancel any in-flight fetch
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const signal = abort.signal;

    setState({
      loading: true,
      error: null,
      latestCommit: null,
      readmeContent: null,
      readmeFilename: null,
      urlInfoRefs: {},
      warning: null,
    });

    // -----------------------------------------------------------------------
    // Mutable display state — updated as results arrive
    // -----------------------------------------------------------------------

    // The commit currently chosen for display (by heuristic).
    let displayResult: CommitResult | null = null;
    // The committer timestamp of the current display commit.
    let displayCommitterDate = 0;
    // Whether the state commit has been successfully fetched.
    let stateCommitFetched = false;
    // Whether all getInfoRefs calls have settled (for error reporting).
    let infoRefsSettled = 0;
    // Per-URL info refs results (accumulated).
    const urlInfoRefs: Record<string, UrlInfoRefsResult> = {};
    // Set of commit hashes we've already started fetching (avoid duplicates).
    const fetchingCommits = new Set<string>();
    // Whether any git server HEAD differed from knownHeadCommit.
    let anyGitHeadDiffersFromState = false;
    // The best git-server HEAD result seen so far (newest committer date).
    let bestGitResult: CommitResult | null = null;

    // -----------------------------------------------------------------------
    // Helper: apply heuristic and update display state
    // -----------------------------------------------------------------------

    function maybeUpdateDisplay(result: CommitResult, isStateCommit: boolean) {
      if (signal.aborted) return;

      const committerDate =
        result.commit.committer?.timestamp ?? result.commit.author.timestamp;

      if (isStateCommit) {
        stateCommitFetched = true;
      } else {
        // Track best git-server result by committer date
        if (
          !bestGitResult ||
          committerDate >
            (bestGitResult.commit.committer?.timestamp ??
              bestGitResult.commit.author.timestamp)
        ) {
          bestGitResult = result;
        }
      }

      if (!displayResult) {
        // First result — show it immediately
        displayResult = result;
        displayCommitterDate = committerDate;
        setState((prev) => ({
          ...prev,
          loading: false,
          latestCommit: result.commit,
          readmeContent: result.readmeContent,
          readmeFilename: result.readmeFilename,
          warning: null,
        }));
        return;
      }

      // Determine if this result should replace the current display.
      // A result wins if it has a newer committer date.
      if (committerDate > displayCommitterDate) {
        displayResult = result;
        displayCommitterDate = committerDate;
        setState((prev) => ({
          ...prev,
          loading: false,
          latestCommit: result.commit,
          // Only update README if the new result has one (or explicitly has none)
          readmeContent: result.readmeContent ?? prev.readmeContent,
          readmeFilename: result.readmeFilename ?? prev.readmeFilename,
          warning: null,
        }));
      }
    }

    // -----------------------------------------------------------------------
    // Helper: recompute warning after all info/refs have settled
    // -----------------------------------------------------------------------

    function recomputeWarning() {
      if (signal.aborted) return;
      if (!displayResult) return;

      const displayHash = displayResult.commit.hash;
      const displayCommitter =
        displayResult.commit.committer?.timestamp ??
        displayResult.commit.author.timestamp;

      // Case 1: state commit declared but not found on any server
      if (
        knownHeadCommit &&
        !stateCommitFetched &&
        anyGitHeadDiffersFromState
      ) {
        setState((prev) => ({
          ...prev,
          warning: {
            kind: "state-commit-unavailable",
            stateCommitId: knownHeadCommit,
          },
        }));
        return;
      }

      // Case 2: git server HEAD is newer than state event
      if (
        knownHeadCommit &&
        stateCreatedAt !== undefined &&
        bestGitResult &&
        anyGitHeadDiffersFromState
      ) {
        const gitCommitterDate =
          bestGitResult.commit.committer?.timestamp ??
          bestGitResult.commit.author.timestamp;

        // If the display commit is the git HEAD (not the state commit), warn
        if (
          !displayHash.startsWith(knownHeadCommit) &&
          !knownHeadCommit.startsWith(displayHash)
        ) {
          setState((prev) => ({
            ...prev,
            warning: {
              kind: "state-behind-git",
              stateCommitId: knownHeadCommit,
              gitCommitId: displayHash,
              stateCreatedAt: stateCreatedAt,
              gitCommitterDate: displayCommitter,
            },
          }));
          return;
        }

        // Display is the state commit but git is ahead — still warn
        if (gitCommitterDate > (stateCreatedAt ?? 0)) {
          const gitHash = bestGitResult.commit.hash;
          if (
            !gitHash.startsWith(knownHeadCommit) &&
            !knownHeadCommit.startsWith(gitHash)
          ) {
            setState((prev) => ({
              ...prev,
              warning: {
                kind: "state-behind-git",
                stateCommitId: knownHeadCommit,
                gitCommitId: gitHash,
                stateCreatedAt: stateCreatedAt,
                gitCommitterDate: gitCommitterDate,
              },
            }));
            return;
          }
        }
      }

      // No warning needed
      setState((prev) => ({ ...prev, warning: null }));
    }

    // -----------------------------------------------------------------------
    // Helper: fetch a commit hash from a specific URL (deduped)
    // -----------------------------------------------------------------------

    async function fetchCommitIfNeeded(
      url: string,
      commitHash: string,
      supportsFilter: boolean,
      isStateCommit: boolean,
    ) {
      if (fetchingCommits.has(commitHash)) return;
      fetchingCommits.add(commitHash);

      const result = await fetchCommitData(
        url,
        commitHash,
        supportsFilter,
        signal,
      );
      if (signal.aborted || !result) return;

      maybeUpdateDisplay(result, isStateCommit);
    }

    // -----------------------------------------------------------------------
    // Phase 1 shortcut: if we know the state HEAD, start fetching it now
    // across all URLs simultaneously (first hit wins via fetchingCommits dedup)
    // -----------------------------------------------------------------------

    if (knownHeadCommit) {
      // We don't know filter capability yet — optimistically try filter=true
      // on all URLs. fetchCommitData will fall back gracefully on failure.
      // We mark the commit as "being fetched" immediately so the per-URL
      // getInfoRefs handlers don't duplicate the work.
      //
      // Note: we do NOT add to fetchingCommits here because we want each URL
      // to independently attempt the state commit (first success wins via
      // maybeUpdateDisplay's committer-date comparison). The dedup in
      // fetchCommitIfNeeded is only for git-server HEAD commits discovered
      // via getInfoRefs.
      Promise.any(
        cloneUrls.map(async (url) => {
          const result = await fetchCommitData(
            url,
            knownHeadCommit,
            true,
            signal,
          );
          if (!result) throw new Error("not found");
          return result;
        }),
      )
        .then((result) => {
          if (signal.aborted) return;
          maybeUpdateDisplay(result, true);
        })
        .catch(() => {
          // State commit not found on any server — will be surfaced as warning
          // once getInfoRefs settles
        });
    }

    // -----------------------------------------------------------------------
    // Phase 1: race getInfoRefs across all URLs concurrently.
    // Each URL resolves independently — we don't wait for all of them.
    // -----------------------------------------------------------------------

    const totalUrls = cloneUrls.length;

    for (const url of cloneUrls) {
      getInfoRefs(url)
        .then(async (info) => {
          if (signal.aborted) return;

          const headRef = info.symrefs["HEAD"];
          const headCommit = headRef
            ? info.refs[headRef]
            : Object.values(info.refs)[0];

          const urlResult: UrlInfoRefsResult = {
            status: "ok",
            headCommit: headCommit ?? "",
            headRef: headRef,
            info,
          };
          urlInfoRefs[url] = urlResult;
          setState((prev) => ({
            ...prev,
            urlInfoRefs: { ...prev.urlInfoRefs, [url]: urlResult },
          }));

          if (!headCommit) return;

          const supportsFilter = info.capabilities.includes("filter");

          // Check if this URL's HEAD differs from the state commit
          const matchesStateCommit =
            knownHeadCommit &&
            (headCommit.startsWith(knownHeadCommit) ||
              knownHeadCommit.startsWith(headCommit));

          if (!matchesStateCommit) {
            anyGitHeadDiffersFromState = true;
            // Fetch this git server's HEAD commit data
            await fetchCommitIfNeeded(url, headCommit, supportsFilter, false);
          } else if (!knownHeadCommit) {
            // No state commit known — treat this as the primary fetch
            await fetchCommitIfNeeded(url, headCommit, supportsFilter, false);
          }
        })
        .catch((err: unknown) => {
          if (signal.aborted) return;
          const message = err instanceof Error ? err.message : String(err);
          urlInfoRefs[url] = { status: "error", error: message };
          setState((prev) => ({
            ...prev,
            urlInfoRefs: {
              ...prev.urlInfoRefs,
              [url]: { status: "error", error: message },
            },
          }));
        })
        .finally(() => {
          if (signal.aborted) return;
          infoRefsSettled++;
          if (infoRefsSettled === totalUrls) {
            // All getInfoRefs calls have settled — recompute warning and
            // apply heuristic for final display state.
            recomputeWarning();

            // If we still have no display result at all, set error
            if (!displayResult) {
              setState((prev) => ({
                ...prev,
                loading: false,
                error: "Could not reach any clone URL",
              }));
            } else {
              setState((prev) => ({ ...prev, loading: false }));
            }
          }
        });
    }

    return () => {
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey, knownHeadCommit]);

  return state;
}
