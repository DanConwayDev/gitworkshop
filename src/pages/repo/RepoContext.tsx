import { createContext, useContext } from "react";
import type { ResolvedRepository } from "@/hooks/useResolvedRepository";
import type { ResolvedIssue, RepoQueryOptions } from "@/lib/nip34";

export interface RepoContextValue {
  /** Hex pubkey of the selected maintainer (always resolved, even for nip05 routes). */
  pubkey: string;
  repoId: string;
  /** The resolved repository data and relay groups. */
  resolved: ResolvedRepository | undefined;
  issues: ResolvedIssue[] | undefined;
  queryOptions: RepoQueryOptions;
  /** Set when the route was a NIP-05 address (e.g. "user@domain.com"). */
  nip05?: string;
}

export const RepoContext = createContext<RepoContextValue | null>(null);

export function useRepoContext(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepoContext must be used within RepoLayout");
  return ctx;
}
