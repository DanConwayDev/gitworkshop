/**
 * useResolvedIssue — unified hook for the issue detail page.
 *
 * Replaces the per-item hooks (useIssueStatus, useIssueLabels,
 * useIssueSubjectRenames, useIssueComments, useIssueZaps, useIssueMaintainers)
 * with a single hook that returns a `ResolvedIssue`.
 *
 * Internally:
 * 1. Fetches the root event from relays and triggers tiered loading via
 *    useNip34ItemDetailLoader
 * 2. Subscribes to IssueDetailModel which reactively produces ResolvedIssue
 */

import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { useNip34ItemDetailLoader } from "./useNip34Loaders";
import { IssueDetailModel } from "@/models/IssueDetailModel";
import { type ResolvedIssue } from "@/lib/nip34";
import type { RelayGroup } from "applesauce-relay";
import type { Observable } from "rxjs";

/**
 * Unified hook for the issue detail page.
 *
 * @param issueId         - The event ID of the root issue
 * @param repoRelayGroup  - Base relay group from useResolvedRepository
 * @param extraRelaysForMaintainerMailboxCoverage - Delta relay group for outbox mode
 * @param maintainers     - Effective maintainer set from repo resolution
 */
export function useResolvedIssue(
  issueId: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  extraRelaysForMaintainerMailboxCoverage: RelayGroup | undefined,
  maintainers: Set<string> | undefined,
): ResolvedIssue | undefined {
  const store = useEventStore();

  const maintainerKey = useNip34ItemDetailLoader(
    issueId,
    repoRelayGroup,
    extraRelaysForMaintainerMailboxCoverage,
    maintainers,
  );

  return use$(() => {
    if (!issueId) return undefined;
    return store.model(
      IssueDetailModel,
      issueId,
      maintainers,
    ) as unknown as Observable<ResolvedIssue | undefined>;
  }, [issueId, maintainerKey, store]);
}
