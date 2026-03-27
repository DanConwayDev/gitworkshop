import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import type { RelayGroup } from "applesauce-relay";
import {
  PR_ROOT_KINDS,
  PR_UPDATE_KIND,
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
  type ResolvedPRLite,
  type RepoQueryOptions,
} from "@/lib/nip34";
import { ISSUE_LABEL_NAMESPACE } from "@/blueprints/label";
import { PRListModel } from "@/models/PRListModel";
import { getTagValue, type Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import { nip34RepoLoader } from "@/services/nostr";
import { castTimelineStream } from "applesauce-common/observable";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import { PRUpdate } from "@/casts/PRUpdate";

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
  // into nip34EssentialsLoader via nip34RepoLoader. The factory handles dedup
  // (seenIds in closure) and closes cleanly on unsubscribe. Filter merging
  // with nip34ItemLoader calls from useNip34ItemLoader is automatic because
  // both share the same singleton loader instances.
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
 * Fetch all NIP-22 comments (kind:1111) for a PR/patch AND all its revision
 * root patches. Returns a flat merged array of all comments across every
 * revision, deduplicated by event ID.
 *
 * This is used on the PR detail page so comments on individual revisions
 * appear in the conversation timeline alongside comments on the root.
 *
 * @param rootId      - The event ID of the original root patch / PR
 * @param revisionIds - Event IDs of all revision root patches
 */
export function usePRAllComments(
  rootId: string | undefined,
  revisionIds: string[],
): NostrEvent[] | undefined {
  const store = useEventStore();
  const allIds = useMemo(() => {
    if (!rootId) return [];
    return [rootId, ...revisionIds];
  }, [rootId, revisionIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const idsKey = allIds.join(",");

  return use$(() => {
    if (allIds.length === 0) return undefined;
    // Query all comment roots in one filter — relays index #E so this is efficient
    return store.timeline([
      { kinds: [COMMENT_KIND], "#E": allIds } as Filter,
    ]) as unknown as Observable<NostrEvent[]>;
  }, [idsKey, store]);
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
 * Return all kind:1619 PR Update events for a specific PR, cast to PRUpdate,
 * sorted oldest-first.
 *
 * These are already fetched by nip34CommentsLoader (kinds [1111, 1619] with #E).
 */
export function usePRUpdates(prId: string | undefined): PRUpdate[] | undefined {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  return use$(() => {
    if (!prId) return undefined;
    return store
      .timeline([{ kinds: [PR_UPDATE_KIND], "#E": [prId] } as Filter])
      .pipe(castTimelineStream(PRUpdate, castStore)) as unknown as Observable<
      PRUpdate[]
    >;
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

/**
 * The effective tip commit, merge base, and clone URLs for a PR, accounting
 * for any authorised PR Update events (kind:1619).
 *
 * Returns the latest authorised PR Update's commit info and clone URLs, or
 * undefined when no updates exist (caller should fall back to the original PR
 * event's tags).
 *
 * Auth: only the PR author or a maintainer may push a PR Update.
 * When selectedMaintainers is undefined (still loading), all updates are
 * accepted so the UI doesn't stay blank.
 *
 * Reactive: re-evaluates whenever a new kind:1619 event lands in the store
 * (e.g. the PR author pushes a new branch revision while the page is open).
 *
 * @param prId                - The event ID of the original PR (kind:1618)
 * @param prPubkey            - The pubkey of the PR author (always authorised)
 * @param selectedMaintainers - Effective maintainer set; undefined = loading
 */
export function usePRTip(
  prId: string | undefined,
  prPubkey: string | undefined,
  selectedMaintainers: Set<string> | undefined,
):
  | {
      tipCommitId: string;
      mergeBase: string | undefined;
      cloneUrls: string[];
    }
  | undefined {
  const store = useEventStore();

  const updates = use$(() => {
    if (!prId) return undefined;
    return store.timeline([
      { kinds: [PR_UPDATE_KIND], "#E": [prId] } as Filter,
    ]) as unknown as Observable<NostrEvent[]>;
  }, [prId, store]);

  if (!updates || updates.length === 0) return undefined;

  // Pick the latest authorised PR Update.
  const latest = updates
    .filter((ev) =>
      isPubkeyAuthorised(ev.pubkey, prPubkey, selectedMaintainers),
    )
    .reduce<
      NostrEvent | undefined
    >((best, ev) => (!best || ev.created_at > best.created_at ? ev : best), undefined);

  if (!latest) return undefined;

  const tipCommitId = latest.tags.find(([t]) => t === "c")?.[1];
  if (!tipCommitId) return undefined;

  return {
    tipCommitId,
    mergeBase: latest.tags.find(([t]) => t === "merge-base")?.[1],
    cloneUrls: latest.tags
      .filter(([t]) => t === "clone")
      .flatMap(([, ...urls]) => urls.filter(Boolean)),
  };
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
