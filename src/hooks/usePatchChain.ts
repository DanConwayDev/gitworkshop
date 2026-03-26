/**
 * usePatchChain — resolves the latest patch revision chain for a root patch.
 *
 * NIP-34 patch sets work as follows:
 *
 *   - A root patch has `["t", "root"]` and no `e` reply tag.
 *   - Additional patches in the same set reply to the previous patch via
 *     `["e", "<prev-patch-id>", "", "reply"]`.
 *   - A revision is a new patch set that supersedes the original. The first
 *     patch in a revision has `["t", "root-revision"]` (or the older
 *     `["t", "revision-root"]`) and an `e reply` tag pointing to the
 *     original root patch.
 *
 * This hook:
 *   1. Fetches all kind:1617 patches that reference the root patch via `#e`.
 *   2. Finds the latest revision root (most recent patch with `root-revision`
 *      tag that replies to the original root).
 *   3. Walks the reply chain from that revision root to collect the ordered
 *      list of patches (oldest → newest).
 *   4. Falls back to the original root patch alone when no replies exist.
 *
 * Returns the ordered patch chain (first patch first) for the latest revision,
 * or undefined while loading.
 */

import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { pool } from "@/services/nostr";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { castTimelineStream } from "applesauce-common/observable";
import { Patch } from "@/casts/Patch";
import { PATCH_KIND } from "@/lib/nip34";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import type { RelayGroup } from "applesauce-relay";

/**
 * Resolve the latest revision chain from a set of patches.
 *
 * Algorithm:
 *   1. Find all patches that are revision roots (root-revision tag) and
 *      reply to the original root patch. Pick the most recent one.
 *   2. If no revision root exists, the original root patch IS the chain start.
 *   3. Walk the reply chain from the chain start, following replyToId links.
 *
 * Returns patches in order: [chainStart, next, ..., tip].
 */
function resolveLatestChain(rootPatchId: string, allPatches: Patch[]): Patch[] {
  if (allPatches.length === 0) return [];

  // Index patches by event ID for O(1) lookup
  const byId = new Map<string, Patch>();
  for (const p of allPatches) {
    byId.set(p.id, p);
  }

  // Build a map: parentId → children (patches that reply to parentId)
  const children = new Map<string, Patch[]>();
  for (const p of allPatches) {
    const parentId = p.replyToId;
    if (parentId) {
      const list = children.get(parentId) ?? [];
      list.push(p);
      children.set(parentId, list);
    }
  }

  // Find the latest revision root — a patch with root-revision tag that
  // replies to the original root patch.
  const revisionRoots = allPatches.filter(
    (p) => p.isRootRevision && p.replyToId === rootPatchId,
  );

  // Pick the most recent revision root (highest created_at)
  const latestRevisionRoot = revisionRoots.reduce<Patch | undefined>(
    (best, p) =>
      !best || p.event.created_at > best.event.created_at ? p : best,
    undefined,
  );

  // Determine the chain start
  const chainStart = latestRevisionRoot ?? byId.get(rootPatchId);
  if (!chainStart) return [];

  // Walk the chain: from chainStart, follow the single-child reply chain.
  // At each step, pick the most recent child (in case of forks/conflicts).
  const chain: Patch[] = [chainStart];
  let current = chainStart;

  // Safety limit to prevent infinite loops
  const MAX_CHAIN_LENGTH = 500;

  while (chain.length < MAX_CHAIN_LENGTH) {
    const kids = children.get(current.id);
    if (!kids || kids.length === 0) break;

    // If there are multiple children, pick the most recent one.
    // (This handles the case where someone sent multiple follow-up patches.)
    const next = kids.reduce((best, p) =>
      p.event.created_at > best.event.created_at ? p : best,
    );

    // Avoid cycles
    if (chain.some((p) => p.id === next.id)) break;

    chain.push(next);
    current = next;
  }

  return chain;
}

export interface PatchChainResult {
  /** Ordered patches in the latest revision (oldest first). */
  chain: Patch[];
  /** Tip commit ID from the last patch's `commit` tag, if present. */
  tipCommitId: string | undefined;
  /** Base commit ID from the first patch's `parent-commit` tag, if present. */
  baseCommitId: string | undefined;
  /** Clone URLs from the first patch's `clone` tags (not standard but some clients add them). */
  cloneUrls: string[];
  /** True while the relay subscription is still loading. */
  loading: boolean;
}

/**
 * Fetches and resolves the latest patch revision chain for a root patch.
 *
 * @param rootPatchId    - The event ID of the root patch (kind:1617 with `t:root`)
 * @param repoRelayGroup - Relay group from useResolvedRepository (preferred)
 * @param fallbackRelays - Extra relay URLs to query when repoRelayGroup is unavailable
 */
export function usePatchChain(
  rootPatchId: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  fallbackRelays: string[] = [],
): PatchChainResult {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  // Fetch all kind:1617 patches that reference the root patch via #e tag.
  // This covers both additional patches in the original set and revision roots.
  use$(() => {
    if (!rootPatchId) return undefined;
    const filter = { kinds: [PATCH_KIND], "#e": [rootPatchId] } as Filter;
    if (repoRelayGroup) {
      return repoRelayGroup
        .subscription([filter])
        .pipe(onlyEvents(), mapEventsToStore(store));
    }
    if (fallbackRelays.length > 0) {
      return pool
        .subscription(fallbackRelays, [filter])
        .pipe(onlyEvents(), mapEventsToStore(store));
    }
    return undefined;
  }, [rootPatchId, repoRelayGroup, fallbackRelays.join(","), store]);

  // Also fetch the root patch itself so it's in the store.
  use$(() => {
    if (!rootPatchId) return undefined;
    const filter: Filter = { kinds: [PATCH_KIND], ids: [rootPatchId] };
    if (repoRelayGroup) {
      return repoRelayGroup
        .subscription([filter])
        .pipe(onlyEvents(), mapEventsToStore(store));
    }
    if (fallbackRelays.length > 0) {
      return pool
        .subscription(fallbackRelays, [filter])
        .pipe(onlyEvents(), mapEventsToStore(store));
    }
    return undefined;
  }, [rootPatchId, repoRelayGroup, fallbackRelays.join(","), store]);

  // Subscribe to all patches in the store that reference the root patch
  // (via #e) plus the root patch itself.
  const referencingPatches = use$(() => {
    if (!rootPatchId) return undefined;
    const filter = { kinds: [PATCH_KIND], "#e": [rootPatchId] } as Filter;
    return store
      .timeline([filter])
      .pipe(castTimelineStream(Patch, castStore)) as unknown as Observable<
      Patch[]
    >;
  }, [rootPatchId, store]);

  const rootPatch = use$(() => {
    if (!rootPatchId) return undefined;
    const filter: Filter = { kinds: [PATCH_KIND], ids: [rootPatchId] };
    return store
      .timeline([filter])
      .pipe(castTimelineStream(Patch, castStore)) as unknown as Observable<
      Patch[]
    >;
  }, [rootPatchId, store]);

  // Combine root patch + all referencing patches into one list
  const allPatches = useMemo(() => {
    const list: Patch[] = [];
    if (rootPatch) list.push(...rootPatch);
    if (referencingPatches) list.push(...referencingPatches);
    // Deduplicate by event ID
    const seen = new Set<string>();
    return list.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [rootPatch, referencingPatches]);

  // Resolve the latest chain
  const chain = useMemo(() => {
    if (!rootPatchId || allPatches.length === 0) return [];
    return resolveLatestChain(rootPatchId, allPatches);
  }, [rootPatchId, allPatches]);

  // Extract tip and base commit IDs from the chain
  const tipCommitId = useMemo(() => {
    if (chain.length === 0) return undefined;
    // Tip is the last patch's commit tag
    return chain[chain.length - 1].commitId;
  }, [chain]);

  const baseCommitId = useMemo(() => {
    if (chain.length === 0) return undefined;
    // Base is the first patch's parent-commit tag
    return chain[0].parentCommitId;
  }, [chain]);

  // Clone URLs from the chain patches (some clients include clone tags on patches)
  const cloneUrls = useMemo(() => {
    const urls: string[] = [];
    const seen = new Set<string>();
    for (const p of chain) {
      for (const tag of p.event.tags) {
        if (tag[0] === "clone") {
          for (const url of tag.slice(1)) {
            if (url && !seen.has(url)) {
              seen.add(url);
              urls.push(url);
            }
          }
        }
      }
    }
    return urls;
  }, [chain]);

  const loading = !rootPatch;

  return { chain, tipCommitId, baseCommitId, cloneUrls, loading };
}
