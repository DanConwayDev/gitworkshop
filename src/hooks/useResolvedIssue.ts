/**
 * useResolvedIssue — unified hook for the issue detail page.
 *
 * Replaces the per-item hooks (useIssueStatus, useIssueLabels,
 * useIssueSubjectRenames, useIssueComments, useIssueZaps, useIssueMaintainers)
 * with a single hook that returns a `ResolvedIssue`.
 *
 * Internally:
 * 1. Fetches the root event from relays (repoRelayGroup + fallback)
 * 2. Triggers tiered loading (essentials, comments, thread) via useNip34ItemLoader
 * 3. Subscribes to IssueDetailModel which reactively produces ResolvedIssue
 */

import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { pool } from "@/services/nostr";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { useNip34ItemLoader } from "./useNip34Loaders";
import { IssueDetailModel } from "@/models/IssueDetailModel";
import { ISSUE_KIND, type ResolvedIssue } from "@/lib/nip34";
import { gitIndexRelays, relayCurationMode } from "@/services/settings";
import type { RelayGroup } from "applesauce-relay";
import type { Filter } from "applesauce-core/helpers";
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
  const curationMode = use$(relayCurationMode);

  // ── 1. Fetch root event from relays ─────────────────────────────────────
  use$(() => {
    if (!issueId) return undefined;
    const filters: Filter[] = [{ kinds: [ISSUE_KIND], ids: [issueId] }];
    if (repoRelayGroup) {
      return repoRelayGroup
        .subscription(filters)
        .pipe(onlyEvents(), mapEventsToStore(store));
    }
    return pool
      .subscription(gitIndexRelays.getValue(), filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [issueId, repoRelayGroup, store]);

  // In outbox mode, also fetch from extra maintainer mailbox relays.
  use$(() => {
    if (
      !issueId ||
      curationMode !== "outbox" ||
      !extraRelaysForMaintainerMailboxCoverage
    )
      return undefined;
    const filters: Filter[] = [{ kinds: [ISSUE_KIND], ids: [issueId] }];
    return extraRelaysForMaintainerMailboxCoverage
      .subscription(filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [issueId, curationMode, extraRelaysForMaintainerMailboxCoverage, store]);

  // ── 2. Trigger tiered loading (essentials + comments + thread) ──────────
  useNip34ItemLoader(issueId, repoRelayGroup, {
    tier: "thread",
    includeAuthorNip65: curationMode === "outbox",
  });

  // ── 3. Subscribe to IssueDetailModel ────────────────────────────────────
  // The model key includes maintainers so it re-creates when they change.
  const maintainerKey = maintainers
    ? [...maintainers].sort().join(",")
    : "loading";

  return use$(() => {
    if (!issueId) return undefined;
    return store.model(
      IssueDetailModel,
      issueId,
      maintainers,
    ) as unknown as Observable<ResolvedIssue | undefined>;
  }, [issueId, maintainerKey, store]);
}
