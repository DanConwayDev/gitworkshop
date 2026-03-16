import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import type { RelayGroup } from "applesauce-relay";
import {
  PR_ROOT_KINDS,
  STATUS_KINDS,
  LABEL_KIND,
  DELETION_KIND,
  COMMENT_KIND,
  SUBJECT_LABEL_NAMESPACE,
  REPO_KIND,
  coordsCacheKey,
  pubkeyFromCoordinate,
  resolveChain,
  kindToStatus,
  type IssueStatus,
  type ResolvedPR,
  type RepoQueryOptions,
} from "@/lib/nip34";
import { ISSUE_LABEL_NAMESPACE } from "@/blueprints/label";
import { PRListModel } from "@/models/PRListModel";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

/** All essential kinds fetched per-PR by nip34EssentialsLoader. */
const ESSENTIALS_KINDS = [...STATUS_KINDS, LABEL_KIND, DELETION_KIND] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when a pubkey is authorised to write status, label, or
 * deletion events for a given PR/patch.
 */
function isPubkeyAuthorised(
  pubkey: string,
  itemPubkey: string | undefined,
  maintainers: Set<string> | undefined,
): boolean {
  if (maintainers === undefined) return true;
  return pubkey === itemPubkey || maintainers.has(pubkey);
}

/**
 * Derive the effective maintainer set for a PR/patch from its first #a tag.
 * Pure function — no hooks, no subscriptions.
 */
export function resolveMaintainersFromPR(
  prEvent: NostrEvent,
  announcementEvents: NostrEvent[],
): Set<string> {
  const coord = prEvent.tags.find(([t]) => t === "a")?.[1];
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
): ResolvedPR[] | undefined {
  const store = useEventStore();

  const coords = useMemo(() => {
    if (!repoCoords) return undefined;
    const arr = Array.isArray(repoCoords) ? repoCoords : [repoCoords];
    return [...arr].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(repoCoords) ? repoCoords.join(",") : repoCoords]);

  const cacheKey = coords ? coordsCacheKey(coords) : "";

  // Fetch PRs/patches from relay via the long-lived group subscription.
  use$(() => {
    if (!coords || coords.length === 0 || !repoRelayGroup) return undefined;
    return repoRelayGroup
      .subscription([{ kinds: [...PR_ROOT_KINDS], "#a": coords } as Filter])
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [cacheKey, repoRelayGroup, store]);

  // Fetch status + label + deletion events from relay.
  use$(() => {
    if (!coords || coords.length === 0 || !repoRelayGroup) return undefined;
    return repoRelayGroup
      .subscription([{ kinds: [...ESSENTIALS_KINDS], "#a": coords } as Filter])
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [cacheKey, repoRelayGroup, store]);

  // Subscribe to the model — cached by the store, shared across components.
  return use$(() => {
    if (!coords || coords.length === 0) return undefined;
    return store.model(PRListModel, cacheKey) as unknown as Observable<
      ResolvedPR[]
    >;
  }, [cacheKey, store]);
}

// ---------------------------------------------------------------------------
// Per-PR hooks (PR detail page)
// ---------------------------------------------------------------------------

/**
 * Subscribe to all essentials events for a single PR/patch from the store.
 */
function usePREssentialEvents(
  prId: string | undefined,
): NostrEvent[] | undefined {
  const store = useEventStore();
  return use$(() => {
    if (!prId) return undefined;
    return store.timeline([
      { kinds: [...ESSENTIALS_KINDS], "#e": [prId] } as Filter,
    ]) as unknown as Observable<NostrEvent[]>;
  }, [prId, store]);
}

/**
 * Fetch comments (NIP-22 kind:1111) for a specific PR/patch.
 */
export function usePRComments(
  prId: string | undefined,
): NostrEvent[] | undefined {
  const store = useEventStore();
  return use$(() => {
    if (!prId) return undefined;
    return store.timeline([
      { kinds: [COMMENT_KIND], "#E": [prId] } as Filter,
    ]) as unknown as Observable<NostrEvent[]>;
  }, [prId, store]);
}

/**
 * Return zap receipts (kind:9735) for a specific PR/patch.
 */
export function usePRZaps(prId: string | undefined): NostrEvent[] | undefined {
  const store = useEventStore();
  return use$(() => {
    if (!prId) return undefined;
    return store.timeline([
      { kinds: [9735], "#e": [prId] } as Filter,
    ]) as unknown as Observable<NostrEvent[]>;
  }, [prId, store]);
}

/**
 * Fetch status events for a specific PR/patch and return the latest valid status.
 *
 * For PRs/patches, only maintainers can set resolved/closed (merge) status.
 * The item author can set open/draft status.
 */
export function usePRStatus(
  prId: string | undefined,
  prPubkey: string | undefined,
  selectedMaintainers: Set<string> | undefined,
): IssueStatus {
  const events = usePREssentialEvents(prId);

  // Deletion takes precedence.
  const isDeleted = events?.some(
    (ev) => ev.kind === DELETION_KIND && ev.pubkey === prPubkey,
  );
  if (isDeleted) return "deleted";

  const latest = events
    ?.filter((ev) => {
      if (!(STATUS_KINDS as readonly number[]).includes(ev.kind)) return false;
      const isMaintainer =
        selectedMaintainers === undefined || selectedMaintainers.has(ev.pubkey);
      const isAuthor = ev.pubkey === prPubkey;
      // Merge statuses (resolved/closed) require maintainer
      const isMergeStatus = ev.kind === 1631 || ev.kind === 1632;
      if (isMergeStatus) return isMaintainer;
      return isAuthor || isMaintainer;
    })
    .reduce<NostrEvent | undefined>(
      (best, ev) => (!best || ev.created_at > best.created_at ? ev : best),
      undefined,
    );

  return latest ? kindToStatus(latest.kind) : "open";
}

/**
 * Return NIP-32 labels for a specific PR/patch.
 */
export function usePRLabels(
  prId: string | undefined,
  prPubkey: string | undefined,
  selectedMaintainers: Set<string> | undefined,
): string[] {
  const events = usePREssentialEvents(prId);
  if (!events || events.length === 0) return [];

  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.kind !== LABEL_KIND) continue;
    if (!isPubkeyAuthorised(ev.pubkey, prPubkey, selectedMaintainers)) continue;
    for (const [t, label, ns] of ev.tags) {
      if (t === "l" && ns === ISSUE_LABEL_NAMESPACE && label) seen.add(label);
    }
  }
  return Array.from(seen).sort();
}

/**
 * Return all kind:1985 subject-rename events for a specific PR/patch.
 */
export function usePRSubjectRenames(
  prId: string | undefined,
  prPubkey: string | undefined,
  selectedMaintainers: Set<string> | undefined,
): NostrEvent[] | undefined {
  const raw = usePREssentialEvents(prId);
  if (!raw) return undefined;

  return raw
    .filter(
      (ev) =>
        ev.kind === LABEL_KIND &&
        ev.tags.some(
          ([t, , ns]) => t === "l" && ns === SUBJECT_LABEL_NAMESPACE,
        ) &&
        isPubkeyAuthorised(ev.pubkey, prPubkey, selectedMaintainers),
    )
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
}

/**
 * Returns true if an authorised deletion request exists for the given PR/patch.
 */
export function usePRIsDeleted(
  prId: string | undefined,
  prPubkey: string | undefined,
): boolean {
  const events = usePREssentialEvents(prId);
  if (!events || !prPubkey) return false;
  return events.some(
    (ev) => ev.kind === DELETION_KIND && ev.pubkey === prPubkey,
  );
}

// ---------------------------------------------------------------------------
// Maintainer resolution
// ---------------------------------------------------------------------------

/**
 * Compute the effective maintainer set for a specific PR/patch.
 * Parallel to useIssueMaintainers.
 */
export function usePRMaintainers(
  prId: string | undefined,
  selectedMaintainers: Set<string> | undefined,
): Set<string> | undefined {
  const store = useEventStore();

  const prEvents = use$(() => {
    if (selectedMaintainers !== undefined || !prId) return undefined;
    return store.timeline([
      { kinds: [...PR_ROOT_KINDS], ids: [prId] },
    ]) as unknown as Observable<NostrEvent[]>;
  }, [prId, selectedMaintainers, store]);

  if (selectedMaintainers !== undefined) return selectedMaintainers;
  if (!prEvents || prEvents.length === 0) return undefined;

  return resolveMaintainersFromPR(
    prEvents[0],
    store.getByFilters([{ kinds: [REPO_KIND] }]) as NostrEvent[],
  );
}

// ---------------------------------------------------------------------------
// Subject resolution (reuse from useIssues — same logic)
// ---------------------------------------------------------------------------

/**
 * Compute the current (effective) subject for a PR/patch from pre-filtered,
 * pre-sorted rename events. The last entry wins.
 */
export function resolveCurrentPRSubject(
  originalSubject: string,
  subjectRenames: NostrEvent[] | undefined,
): string {
  if (!subjectRenames || subjectRenames.length === 0) return originalSubject;
  const winner = subjectRenames[subjectRenames.length - 1];
  return (
    winner.tags.find(
      ([t, , ns]) => t === "l" && ns === SUBJECT_LABEL_NAMESPACE,
    )?.[1] ?? originalSubject
  );
}
