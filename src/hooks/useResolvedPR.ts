/**
 * useResolvedPR — unified hook for the PR/patch detail page.
 *
 * Replaces the ~10 per-item hooks (usePRStatus, usePRTip, usePRLabels,
 * usePRSubjectRenames, usePatchChain, usePRUpdates, usePRAllComments, etc.)
 * with a single hook that returns a `ResolvedPR` plus search state.
 *
 * Internally:
 * 1. Fetches the root event from relays via useEventSearch (through
 *    useNip34ItemDetailLoader) and triggers tiered loading
 * 2. For patches: fetches patch chain events from relays
 * 3. Subscribes to PRDetailModel which reactively produces ResolvedPR
 * 4. For patch revisions: batch-loads revision root comments
 *
 * The model handles PR-vs-Patch branching internally. The page never needs
 * to know which kind it's looking at.
 */

import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { withGapFill } from "@/lib/withGapFill";
import { pool } from "@/services/nostr";
import { BACKOFF_RECONNECT } from "@/lib/relay";
import {
  useNip34ItemDetailLoader,
  useNip34ItemLoaderBatch,
} from "./useNip34Loaders";
import type { EventSearchState, RelayGroupSpec } from "./useEventSearch";
import { PRDetailModel } from "@/models/PRDetailModel";
import { PATCH_KIND, type ResolvedPR } from "@/lib/nip34";
import { relayCurationMode } from "@/services/settings";
import type { RelayGroup } from "applesauce-relay";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";

export interface UseResolvedPROptions {
  /** Extra clone URLs for fallback relay queries (from the repo). */
  fallbackCloneUrls?: string[];
}

export interface ResolvedPRResult {
  pr: ResolvedPR | undefined;
  /** Search state — undefined if the event was already in the store */
  search: EventSearchState | undefined;
}

/**
 * Unified hook for the PR/patch detail page.
 *
 * @param prId            - The event ID of the root PR or patch
 * @param repoRelayGroup  - Base relay group from useResolvedRepository
 * @param extraRelaysForMaintainerMailboxCoverage - Delta relay group for outbox mode
 * @param maintainers     - Effective maintainer set from repo resolution
 * @param options         - Additional options
 * @param extraSearchGroups - Additional relay groups for user-triggered expansion
 * @param retryKey        - Increment to force a fresh search across all relays
 */
export function useResolvedPR(
  prId: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  extraRelaysForMaintainerMailboxCoverage: RelayGroup | undefined,
  maintainers: Set<string> | undefined,
  _options?: UseResolvedPROptions,
  extraSearchGroups?: RelayGroupSpec[],
  retryKey?: number,
): ResolvedPRResult {
  const store = useEventStore();
  const curationMode = use$(relayCurationMode);

  // ── 1. Fetch root event + tiered loading (shared with useResolvedIssue) ──
  const { maintainerKey, search } = useNip34ItemDetailLoader(
    prId,
    repoRelayGroup,
    extraRelaysForMaintainerMailboxCoverage,
    maintainers,
    extraSearchGroups,
    retryKey,
  );

  // ── 2. For patches: fetch patch chain events from relays ────────────────
  // Fetch all kind:1617 patches that reference the root via #e.
  // This covers both additional patches in the original set and revision roots.
  // Done unconditionally — for PRs the filter simply won't match anything.
  use$(() => {
    if (!prId) return undefined;
    const filter = { kinds: [PATCH_KIND], "#e": [prId] } as Filter;
    if (repoRelayGroup) {
      return withGapFill(
        repoRelayGroup.subscription([filter], {
          reconnect: BACKOFF_RECONNECT,
          resubscribe: Infinity,
        }),
        pool,
        () => repoRelayGroup.relays.map((r) => r.url),
        [filter],
      ).pipe(onlyEvents(), mapEventsToStore(store));
    }
    return undefined;
  }, [prId, repoRelayGroup, store]);

  // Also fetch the root patch itself (belt and suspenders).
  use$(() => {
    if (!prId) return undefined;
    const filter: Filter = { kinds: [PATCH_KIND], ids: [prId] };
    if (repoRelayGroup) {
      return withGapFill(
        repoRelayGroup.subscription([filter], {
          reconnect: BACKOFF_RECONNECT,
          resubscribe: Infinity,
        }),
        pool,
        () => repoRelayGroup.relays.map((r) => r.url),
        [filter],
      ).pipe(onlyEvents(), mapEventsToStore(store));
    }
    return undefined;
  }, [prId, repoRelayGroup, store]);

  // ── 3. Subscribe to PRDetailModel ───────────────────────────────────────
  const resolved = use$(() => {
    if (!prId) return undefined;
    return store.model(
      PRDetailModel,
      prId,
      maintainers,
    ) as unknown as Observable<ResolvedPR | undefined>;
  }, [prId, maintainerKey, store]);

  // ── 4. For patch revisions: batch-load revision root comments ───────────
  // Once the model resolves, we know which revision root IDs exist.
  // Load their essentials + comments so they appear in the timeline.
  const revisionRootIds = useMemo(() => {
    if (!resolved || resolved.itemType !== "patch") return [];
    return resolved.revisions
      .filter(
        (r) =>
          r.type === "patch-set" &&
          r.rootPatchEvent &&
          r.rootPatchEvent.id !== prId,
      )
      .map((r) => r.rootPatchEvent!.id);
  }, [resolved, prId]);

  useNip34ItemLoaderBatch(revisionRootIds, repoRelayGroup, {
    includeThread: true,
    includeAuthorNip65: curationMode === "outbox",
  });

  return { pr: resolved, search };
}
