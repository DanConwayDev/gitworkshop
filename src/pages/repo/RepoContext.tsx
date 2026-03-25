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
  /**
   * True once the repo relay group has sent EOSE for the state query (all
   * relays responded, timed out, or errored). False while the initial query
   * is still in flight. Always true when there is no repo relay group.
   */
  repoRelayEose: boolean;
  /** Everything after /tree/ in the URL (e.g. "main", "feat/foo/.gitignore").
   *  Ref resolution via longest-prefix matching happens inside useGitExplorer. */
  treeRefAndPath?: string;
  /** The commit ID from the URL (for single-commit view). */
  commitId?: string;
  /** The ref segment from a /commits/:ref URL (branch, tag, or commit hash). */
  commitsRef?: string;
  /**
   * Set when viewing a commit detail scoped to a PR
   * (route: prs/<prId>/commit/<commitId>).
   */
  prCommitId?: string;
  /**
   * The canonical path to the current PR, e.g. "/npub1.../relay/repo/prs/<prId>".
   * Set whenever a PR sub-page is active. Used to build PR-scoped commit links.
   */
  prBasePath?: string;
}

export const RepoContext = createContext<RepoContextValue | null>(null);

export function useRepoContext(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepoContext must be used within RepoLayout");
  return ctx;
}
