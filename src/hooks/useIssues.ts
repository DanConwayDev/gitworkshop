import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import type { RelayGroup } from "applesauce-relay";
import {
  coordsCacheKey,
  pubkeyFromCoordinate,
  resolveChain,
  type ResolvedIssueLite,
  type RepoQueryOptions,
} from "@/lib/nip34";
import { IssueListModel } from "@/models/IssueListModel";
import { getTagValue } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import { nip34RepoLoader } from "@/services/nostr";

// ---------------------------------------------------------------------------
// Maintainer resolution (used by the maintainer fallback path)
// ---------------------------------------------------------------------------

/**
 * Derive the effective maintainer set for an issue from its first #a tag.
 *
 * Uses the first coordinate only — multiple tagged repos are a genuine edge
 * case and a single anchor keeps the trust model simple and consistent with
 * the URL-context case (which also has one selected maintainer).
 *
 * The pubkey is always extractable from the coordinate string itself
 * (`30617:<pubkey>:<dTag>`), so at least one maintainer is known before any
 * 30617 announcement events have been received. BFS resolution via
 * `resolveChain` adds co-maintainers once their announcements are in the store.
 *
 * This is a pure function — no hooks, no subscriptions.
 *
 * @param issue              - The raw issue event
 * @param announcementEvents - All kind:30617 events currently in the store
 */
export function resolveMaintainersFromIssue(
  issue: NostrEvent,
  announcementEvents: NostrEvent[],
): Set<string> {
  const coord = getTagValue(issue, "a");
  if (!coord) return new Set();

  const coordPubkey = pubkeyFromCoordinate(coord);
  if (!coordPubkey) return new Set();

  // Always include the pubkey from the coordinate — known before announcements.
  const maintainers = new Set<string>([coordPubkey]);

  // BFS to include co-maintainers declared in announcements.
  const dTag = coord.split(":").slice(2).join(":");
  const resolved = resolveChain(announcementEvents, coordPubkey, dTag);
  if (resolved) {
    for (const pk of resolved.maintainerSet) maintainers.add(pk);
  }

  return maintainers;
}

// ---------------------------------------------------------------------------
// Bulk hook (repo issue list)
// ---------------------------------------------------------------------------

/**
 * Fetch and reactively resolve issues for a repository.
 *
 * Accepts either a single coordinate string or an array of coordinate strings
 * (one per maintainer in the chain). Passing all maintainer coordinates
 * ensures issues tagged against any co-maintainer's announcement are included.
 *
 * Returns a flat list of ResolvedIssueLite objects — each combining the raw
 * issue event with its current status, labels, and subject from essentials
 * events. Consumers can filter and display directly without holding separate
 * maps.
 *
 * The resolved list is backed by IssueListModel, which is cached by the store
 * keyed on the sorted coordinate string. Multiple components subscribing to
 * the same repo share one model instance and one set of store subscriptions.
 *
 * Always pass repoRelayGroup from useResolvedRepository. When outbox curation
 * mode is enabled, the caller is responsible for separately subscribing to
 * extraRelaysForMaintainerMailboxCoverage so events from those relays land in
 * the store; this hook reads from the store regardless of which group fetched
 * the events.
 *
 * @param repoCoords     - Coordinate string(s) for the repository
 * @param repoRelayGroup - Base RelayGroup from useResolvedRepository
 * @param options        - Query options including relay hints from the URL/settings
 */
export function useIssues(
  repoCoords: string | string[] | undefined,
  repoRelayGroup: RelayGroup | undefined,
  _options: RepoQueryOptions,
): ResolvedIssueLite[] | undefined {
  const store = useEventStore();

  // Normalise to a sorted array for consistent filter building and cache keys.
  const coords = useMemo(() => {
    if (!repoCoords) return undefined;
    const arr = Array.isArray(repoCoords) ? repoCoords : [repoCoords];
    return [...arr].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(repoCoords) ? repoCoords.join(",") : repoCoords]);

  const cacheKey = coords ? coordsCacheKey(coords) : "";

  // Fetch issues from relay and pipe each newly discovered issue ID into
  // nip34ListLoader via nip34RepoLoader. The factory handles dedup (seenIds
  // in closure) and closes cleanly on unsubscribe. Filter merging with
  // useNip34ItemLoader calls is automatic because both share the same
  // singleton loader instances.
  use$(() => {
    if (!coords || coords.length === 0 || !repoRelayGroup) return undefined;
    return nip34RepoLoader(coords, repoRelayGroup);
  }, [cacheKey, repoRelayGroup]);

  // Subscribe to the model — cached by the store, shared across components.
  return use$(() => {
    if (!coords || coords.length === 0) return undefined;
    return store.model(IssueListModel, cacheKey) as unknown as Observable<
      ResolvedIssueLite[]
    >;
  }, [cacheKey, store]);
}
