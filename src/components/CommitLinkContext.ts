/**
 * GitCommitLinkContext — provides clone URLs and repo base path to any
 * descendant that needs to resolve commit hashes into links.
 *
 * Provided by RepoLayout so that CommentContent and MarkdownContent can
 * linkify bare commit-hash strings without prop drilling.
 */

import { createContext, useContext } from "react";

export interface GitCommitLinkContextValue {
  /** Clone URLs for the current repository. Used to look up the git pool. */
  cloneUrls: string[];
  /** Base path for the repo (e.g. "/npub1.../relay/repo"). */
  basePath: string;
}

export const GitCommitLinkContext =
  createContext<GitCommitLinkContextValue | null>(null);

export function useGitCommitLinkContext(): GitCommitLinkContextValue | null {
  return useContext(GitCommitLinkContext);
}
