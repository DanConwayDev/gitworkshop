import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import type { RelayGroup } from "applesauce-relay";
import {
  coordsCacheKey,
  pubkeyFromCoordinate,
  resolveChain,
  type ResolvedPRLite,
  type RepoQueryOptions,
} from "@/lib/nip34";
import { PRListModel } from "@/models/PRListModel";
import { getTagValue } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import { nip34RepoLoader } from "@/services/nostr";

// ---------------------------------------------------------------------------
// Maintainer resolution (used by the maintainer fallback path)
// ---------------------------------------------------------------------------

/**
 * Derive the effective maintainer set for a PR/patch from its first #a tag.
 * Pure function — no hooks, no subscriptions.
 */
export function resolveMaintainersFromPR(
  prEvent: NostrEvent,
  announcementEvents: NostrEvent[],
): Set<string> {
  const coord = getTagValue(prEvent, "a");
  if (!coord) return new Set();

  const coordPubkey = pubkeyFromCoordinate(coord);
  if (!coordPubkey) return new Set();

  const maintainers = new Set<string>([coordPubkey]);

  const dTag = coord.split(":").slice(2).join(":");
  const resolved = resolveChain(announcementEvents, coordPubkey, dTag);
  if (resolved) {
    for (const pk of resolved.maintainerSet) maintainers.add(pk);
  }

  return maintainers;
}

// ---------------------------------------------------------------------------
// Bulk hook (repo PR list)
// ---------------------------------------------------------------------------

/**
 * Fetch and reactively resolve PRs and root patches for a repository.
 *
 * Parallel to useIssues but queries kinds [1617, 1618] and uses PRListModel.
 */
export function usePRs(
  repoCoords: string | string[] | undefined,
  repoRelayGroup: RelayGroup | undefined,
  _options: RepoQueryOptions,
): ResolvedPRLite[] | undefined {
  const store = useEventStore();

  const coords = useMemo(() => {
    if (!repoCoords) return undefined;
    const arr = Array.isArray(repoCoords) ? repoCoords : [repoCoords];
    return [...arr].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(repoCoords) ? repoCoords.join(",") : repoCoords]);

  const cacheKey = coords ? coordsCacheKey(coords) : "";

  // Fetch PRs/patches from relay and pipe each newly discovered root item ID
  // into nip34ListLoader via nip34RepoLoader. The factory handles dedup
  // (seenIds in closure) and closes cleanly on unsubscribe. Filter merging
  // with useNip34ItemLoader calls is automatic because both share the same
  // singleton loader instances.
  use$(() => {
    if (!coords || coords.length === 0 || !repoRelayGroup) return undefined;
    return nip34RepoLoader(coords, repoRelayGroup);
  }, [cacheKey, repoRelayGroup]);

  // Subscribe to the model — cached by the store, shared across components.
  return use$(() => {
    if (!coords || coords.length === 0) return undefined;
    return store.model(PRListModel, cacheKey) as unknown as Observable<
      ResolvedPRLite[]
    >;
  }, [cacheKey, store]);
}
