import { createContext, useContext } from "react";
import type { ResolvedRepository } from "@/hooks/useResolvedRepository";
import type { ResolvedIssue, ResolvedPR, RepoQueryOptions } from "@/lib/nip34";
import type { RepositoryState } from "@/casts/RepositoryState";

export interface RepoContextValue {
  /** Hex pubkey of the selected maintainer (always resolved, even for nip05 routes). */
  pubkey: string;
  repoId: string;
  /** The resolved repository data and relay groups. */
  resolved: ResolvedRepository | undefined;
  issues: ResolvedIssue[] | undefined;
  prs: ResolvedPR[] | undefined;
  queryOptions: RepoQueryOptions;
  /** Set when the route was a NIP-05 address (e.g. "user@domain.com"). */
  nip05?: string;
  /** Set when viewing a specific issue (replaces useParams issueId). */
  issueId?: string;
  /** Set when viewing a specific PR or patch. */
  prId?: string;
  /** Clone URLs for the repository (from the resolved repo announcement). */
  cloneUrls: string[];
  /** The winning Nostr state event (kind:30618), or null if none found. */
  repoState: RepositoryState | null | undefined;
  /** Everything after /tree/ in the URL (e.g. "main", "feat/foo/.gitignore").
   *  Ref resolution via longest-prefix matching happens inside useGitExplorer. */
  treeRefAndPath?: string;
  /** The commit ID from the URL (for single-commit view). */
  commitId?: string;
  /** The ref segment from a /commits/:ref URL (branch, tag, or commit hash). */
  commitsRef?: string;
}

export const RepoContext = createContext<RepoContextValue | null>(null);

export function useRepoContext(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepoContext must be used within RepoLayout");
  return ctx;
}
