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
import { resilientSubscription } from "@/lib/resilientSubscription";
import { withGapFill } from "@/lib/withGapFill";
import { castTimelineStream } from "applesauce-common/observable";
import { Patch } from "@/casts/Patch";
import { PATCH_KIND } from "@/lib/nip34";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import type { RelayGroup } from "applesauce-relay";

/**
 * Walk the reply chain from a given start patch, following replyToId links.
 * Returns patches in order: [start, next, ..., tip].
 */
function walkChain(
  start: Patch,
  children: Map<string, Patch[]>,
  visited: Set<string>,
): Patch[] {
  const chain: Patch[] = [start];
  visited.add(start.id);
  let current = start;

  const MAX_CHAIN_LENGTH = 500;

  while (chain.length < MAX_CHAIN_LENGTH) {
    const kids = children.get(current.id);
    if (!kids || kids.length === 0) break;

    // Exclude revision roots — they start new chains, not continuations
    const nonRevisionKids = kids.filter(
      (p) => !p.isRootRevision && !visited.has(p.id),
    );
    if (nonRevisionKids.length === 0) break;

    // Pick the most recent non-revision child
    const next = nonRevisionKids.reduce((best, p) =>
      p.event.created_at > best.event.created_at ? p : best,
    );

    if (visited.has(next.id)) break;
    visited.add(next.id);
    chain.push(next);
    current = next;
  }

  return chain;
}

/**
 * Resolve ALL revision chains from a set of patches, ordered oldest-first.
 *
 * Returns an array of PatchRevision objects, one per push:
 *   - The first entry is always the original root patch chain.
 *   - Subsequent entries are revision chains (root-revision patches), sorted
 *     by created_at ascending.
 *
 * The last entry is the "current" (latest) revision; all earlier ones are
 * superseded.
 */
export function resolveAllChains(
  rootPatchId: string,
  allPatches: Patch[],
): PatchRevision[] {
  if (allPatches.length === 0) return [];

  const byId = new Map<string, Patch>();
  for (const p of allPatches) byId.set(p.id, p);

  // Build children map (parentId → children)
  const children = new Map<string, Patch[]>();
  for (const p of allPatches) {
    const parentId = p.replyToId;
    if (parentId) {
      const list = children.get(parentId) ?? [];
      list.push(p);
      children.set(parentId, list);
    }
  }

  const rootPatch = byId.get(rootPatchId);
  if (!rootPatch) return [];

  const visited = new Set<string>();

  // Original chain starting from the root patch
  const originalChain = walkChain(rootPatch, children, visited);

  const revisions: PatchRevision[] = [
    { rootPatch, chain: originalChain, isRevision: false },
  ];

  // Find all revision roots (direct replies to rootPatchId with root-revision tag)
  const revisionRoots = allPatches
    .filter((p) => p.isRootRevision && p.replyToId === rootPatchId)
    .sort((a, b) => a.event.created_at - b.event.created_at);

  for (const revRoot of revisionRoots) {
    if (visited.has(revRoot.id)) continue;
    const chain = walkChain(revRoot, children, visited);
    revisions.push({ rootPatch: revRoot, chain, isRevision: true });
  }

  return revisions;
}

/**
 * A single push revision — either the original patch set or a subsequent
 * revision (root-revision). The last entry in `allRevisions` is the current
 * (latest) state; all earlier ones are superseded.
 */
export interface PatchRevision {
  /** The root patch of this revision (has t:root or t:root-revision). */
  rootPatch: Patch;
  /** Ordered patches in this revision's chain (oldest first). */
  chain: Patch[];
  /** True when this is a revision (not the original root patch set). */
  isRevision: boolean;
}

export interface PatchChainResult {
  /** Ordered patches in the latest revision (oldest first). */
  chain: Patch[];
  /** All revisions ordered oldest-first. Last entry is current; earlier are superseded. */
  allRevisions: PatchRevision[];
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
      return withGapFill(
        repoRelayGroup.subscription([filter]),
        pool,
        () => repoRelayGroup.relays.map((r) => r.url),
        [filter],
      ).pipe(onlyEvents(), mapEventsToStore(store));
    }
    if (fallbackRelays.length > 0) {
      return resilientSubscription(pool, fallbackRelays, [filter]).pipe(
        onlyEvents(),
        mapEventsToStore(store),
      );
    }
    return undefined;
  }, [rootPatchId, repoRelayGroup, fallbackRelays.join(","), store]);

  // Also fetch the root patch itself so it's in the store.
  use$(() => {
    if (!rootPatchId) return undefined;
    const filter: Filter = { kinds: [PATCH_KIND], ids: [rootPatchId] };
    if (repoRelayGroup) {
      return withGapFill(
        repoRelayGroup.subscription([filter]),
        pool,
        () => repoRelayGroup.relays.map((r) => r.url),
        [filter],
      ).pipe(onlyEvents(), mapEventsToStore(store));
    }
    if (fallbackRelays.length > 0) {
      return resilientSubscription(pool, fallbackRelays, [filter]).pipe(
        onlyEvents(),
        mapEventsToStore(store),
      );
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

  // Resolve all revision chains (oldest first; last is current)
  const allRevisions = useMemo(() => {
    if (!rootPatchId || allPatches.length === 0) return [];
    return resolveAllChains(rootPatchId, allPatches);
  }, [rootPatchId, allPatches]);

  // Latest chain (for backward compat + tip/base extraction)
  const chain = useMemo(() => {
    if (allRevisions.length === 0) return [];
    return allRevisions[allRevisions.length - 1].chain;
  }, [allRevisions]);

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

  return { chain, allRevisions, tipCommitId, baseCommitId, cloneUrls, loading };
}
