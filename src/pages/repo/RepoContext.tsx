import { createContext, useContext } from "react";
import type { ResolvedRepository } from "@/hooks/useResolvedRepository";
import type { ResolvedIssue, RepoQueryOptions } from "@/lib/nip34";

export interface RepoContextValue {
  npub: string;
  repoId: string;
  pubkey: string;
  resolved: ResolvedRepository | undefined;
  issues: ResolvedIssue[] | undefined;
  queryOptions: RepoQueryOptions;
}

export const RepoContext = createContext<RepoContextValue | null>(null);

export function useRepoContext(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepoContext must be used within RepoLayout");
  return ctx;
}
