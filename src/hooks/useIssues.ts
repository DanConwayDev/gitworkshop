import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import type { RelayGroup } from "applesauce-relay";
import {
  ISSUE_KIND,
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
  type ResolvedIssue,
  type RepoQueryOptions,
} from "@/lib/nip34";
import { ISSUE_LABEL_NAMESPACE } from "@/blueprints/label";
import { IssueListModel } from "@/models/IssueListModel";
import { getTagValue, type Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import { bufferTime, mergeMap, filter } from "rxjs/operators";
import { EMPTY } from "rxjs";
import type { Observable } from "rxjs";

/** All essential kinds fetched per-issue by nip34EssentialsLoader. */
const ESSENTIALS_KINDS = [...STATUS_KINDS, LABEL_KIND, DELETION_KIND] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when a pubkey is authorised to write status, label, or
 * deletion events for a given issue.
 *
 * - `undefined` maintainers means the set is still loading — accept everyone
 *   so the UI doesn't stay blank while resolution is in progress.
 * - Otherwise, only the issue author and known maintainers are authorised.
 */
function isPubkeyAuthorised(
  pubkey: string,
  issuePubkey: string | undefined,
  maintainers: Set<string> | undefined,
): boolean {
  if (maintainers === undefined) return true;
  return pubkey === issuePubkey || maintainers.has(pubkey);
}

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
 * Returns a flat list of ResolvedIssue objects — each combining the raw issue
 * event with its current status, labels, and subject from essentials events.
 * Consumers can filter and display directly without holding separate maps.
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
): ResolvedIssue[] | undefined {
  const store = useEventStore();

  // Normalise to a sorted array for consistent filter building and cache keys.
  const coords = useMemo(() => {
    if (!repoCoords) return undefined;
    const arr = Array.isArray(repoCoords) ? repoCoords : [repoCoords];
    return [...arr].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(repoCoords) ? repoCoords.join(",") : repoCoords]);

  const cacheKey = coords ? coordsCacheKey(coords) : "";

  // Fetch issues from relay via the long-lived group subscription.
  use$(() => {
    if (!coords || coords.length === 0 || !repoRelayGroup) return undefined;
    return repoRelayGroup
      .subscription([{ kinds: [ISSUE_KIND], "#a": coords } as Filter])
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [cacheKey, repoRelayGroup, store]);

  // Fetch status + label + deletion events from relay, keyed by issue ID.
  // Status/label/deletion events reference the issue via "#e" (not "#a"), so
  // we pipe the issues relay stream through bufferTime to batch IDs that arrive
  // in quick succession (e.g. initial relay burst) into a single subscription.
  // mergeMap keeps existing subscriptions alive; seenIds ensures each ID is
  // only subscribed once across batches.
  use$(() => {
    if (!coords || coords.length === 0 || !repoRelayGroup) return undefined;
    const seenIds = new Set<string>();
    return repoRelayGroup
      .subscription([{ kinds: [ISSUE_KIND], "#a": coords } as Filter])
      .pipe(
        onlyEvents(),
        mapEventsToStore(store),
        bufferTime(100),
        filter((batch) => batch.length > 0),
        mergeMap((batch) => {
          const newIds = (batch as NostrEvent[])
            .map((ev) => ev.id)
            .filter((id) => !seenIds.has(id));
          if (newIds.length === 0) return EMPTY;
          for (const id of newIds) seenIds.add(id);
          return repoRelayGroup
            .subscription([
              { kinds: [...ESSENTIALS_KINDS], "#e": newIds } as Filter,
            ])
            .pipe(onlyEvents(), mapEventsToStore(store));
        }),
      );
  }, [cacheKey, repoRelayGroup, store]);

  // Subscribe to the model — cached by the store, shared across components.
  return use$(() => {
    if (!coords || coords.length === 0) return undefined;
    return store.model(IssueListModel, cacheKey) as unknown as Observable<
      ResolvedIssue[]
    >;
  }, [cacheKey, store]);
}

// ---------------------------------------------------------------------------
// Per-issue hooks (issue detail page)
// ---------------------------------------------------------------------------

/**
 * Subscribe to all essentials events (status, labels, deletions) for a single
 * issue from the store in one timeline subscription. Shared by the per-issue
 * hooks below to avoid duplicate subscriptions on the same filter.
 *
 * No relay fetch — nip34EssentialsLoader (called by useNip34Loaders) already
 * batches { kinds: [1630-1633,1985,5], "#e": [issueId] }.
 */
function useIssueEssentialEvents(
  issueId: string | undefined,
): NostrEvent[] | undefined {
  const store = useEventStore();
  return use$(() => {
    if (!issueId) return undefined;
    return store.timeline([
      { kinds: [...ESSENTIALS_KINDS], "#e": [issueId] } as Filter,
    ]) as unknown as Observable<NostrEvent[]>;
  }, [issueId, store]);
}

/**
 * Fetch comments (NIP-22 kind:1111) for a specific issue.
 *
 * Fetching is handled by useNip34Loaders (called by IssuePage), which batches
 * { kinds: [1111], "#E": [issueId] } and, when useItemAuthorRelays is true,
 * also queries the inbox-only delta relays of the issue author.
 */
export function useIssueComments(
  issueId: string | undefined,
): NostrEvent[] | undefined {
  const store = useEventStore();
  return use$(() => {
    if (!issueId) return undefined;
    return store.timeline([
      { kinds: [COMMENT_KIND], "#E": [issueId] } as Filter,
    ]) as unknown as Observable<NostrEvent[]>;
  }, [issueId, store]);
}

/**
 * Return zap receipts (kind:9735) for a specific issue.
 *
 * Fetching is handled by useNip34Loaders (called by IssuePage), which batches
 * { kinds: [7, 9735], "#e": [issueId] } and, when useItemAuthorRelays is true,
 * also queries the inbox-only delta relays of the issue author.
 */
export function useIssueZaps(
  issueId: string | undefined,
): NostrEvent[] | undefined {
  const store = useEventStore();
  return use$(() => {
    if (!issueId) return undefined;
    return store.timeline([
      { kinds: [9735], "#e": [issueId] } as Filter,
    ]) as unknown as Observable<NostrEvent[]>;
  }, [issueId, store]);
}

/**
 * Fetch status events for a specific issue and return the latest valid status.
 *
 * Only status events authored by a maintainer or the issue author are
 * considered authoritative. When `selectedMaintainers` is `undefined`
 * (still loading), all events are accepted so the UI doesn't stay blank.
 *
 * No relay fetch — nip34EssentialsLoader (called by useNip34Loaders in
 * IssuePage) already batches { kinds: [1630-1633,1985,5], "#e": [issueId] }.
 *
 * @param issueId             - The event ID of the issue
 * @param issuePubkey         - The pubkey of the issue author (always authorised)
 * @param selectedMaintainers - Effective maintainer set; undefined = loading
 */
export function useIssueStatus(
  issueId: string | undefined,
  issuePubkey: string | undefined,
  selectedMaintainers: Set<string> | undefined,
): IssueStatus {
  const events = useIssueEssentialEvents(issueId);

  // Deletion takes precedence over all status events.
  const isDeleted = events?.some(
    (ev) => ev.kind === DELETION_KIND && ev.pubkey === issuePubkey,
  );
  if (isDeleted) return "deleted";

  const latest = events
    ?.filter(
      (ev) =>
        (STATUS_KINDS as readonly number[]).includes(ev.kind) &&
        isPubkeyAuthorised(ev.pubkey, issuePubkey, selectedMaintainers),
    )
    .reduce<
      NostrEvent | undefined
    >((best, ev) => (!best || ev.created_at > best.created_at ? ev : best), undefined);

  return latest ? kindToStatus(latest.kind) : "open";
}

/**
 * Return NIP-32 labels (kind:1985, `#t` namespace) for a specific issue.
 *
 * Only label events from authorised authors are accepted. When
 * `selectedMaintainers` is `undefined` (loading), all events are accepted.
 *
 * @param issueId             - The event ID of the issue
 * @param issuePubkey         - The pubkey of the issue author (always authorised)
 * @param selectedMaintainers - Effective maintainer set; undefined = loading
 */
export function useIssueLabels(
  issueId: string | undefined,
  issuePubkey: string | undefined,
  selectedMaintainers: Set<string> | undefined,
): string[] {
  const events = useIssueEssentialEvents(issueId);
  if (!events || events.length === 0) return [];

  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.kind !== LABEL_KIND) continue;
    if (!isPubkeyAuthorised(ev.pubkey, issuePubkey, selectedMaintainers))
      continue;
    for (const [t, label, ns] of ev.tags) {
      if (t === "l" && ns === ISSUE_LABEL_NAMESPACE && label) seen.add(label);
    }
  }
  return Array.from(seen).sort();
}

/**
 * Return all kind:1985 subject-rename events for a specific issue, sorted by
 * created_at ascending (oldest first), with id as a tiebreaker.
 *
 * Only rename events from authorised authors are accepted. When
 * `selectedMaintainers` is `undefined` (loading), all events are accepted.
 *
 * @param issueId             - The event ID of the issue
 * @param issuePubkey         - The pubkey of the issue author (always authorised)
 * @param selectedMaintainers - Effective maintainer set; undefined = loading
 */
export function useIssueSubjectRenames(
  issueId: string | undefined,
  issuePubkey: string | undefined,
  selectedMaintainers: Set<string> | undefined,
): NostrEvent[] | undefined {
  const raw = useIssueEssentialEvents(issueId);
  if (!raw) return undefined;

  return raw
    .filter(
      (ev) =>
        ev.kind === LABEL_KIND &&
        ev.tags.some(
          ([t, , ns]) => t === "l" && ns === SUBJECT_LABEL_NAMESPACE,
        ) &&
        isPubkeyAuthorised(ev.pubkey, issuePubkey, selectedMaintainers),
    )
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
}

/**
 * Returns true if an authorised deletion request (kind:5) exists for the
 * given issue. Only the issue author's own deletion is valid per NIP-09.
 *
 * @param issueId     - The event ID of the issue
 * @param issuePubkey - The pubkey of the issue author
 */
export function useIssueIsDeleted(
  issueId: string | undefined,
  issuePubkey: string | undefined,
): boolean {
  const events = useIssueEssentialEvents(issueId);
  if (!events || !issuePubkey) return false;
  return events.some(
    (ev) => ev.kind === DELETION_KIND && ev.pubkey === issuePubkey,
  );
}

// ---------------------------------------------------------------------------
// Maintainer resolution
// ---------------------------------------------------------------------------

/**
 * Compute the effective maintainer set for a specific issue.
 *
 * When `selectedMaintainers` is a `Set<string>` (URL context known — e.g. the
 * selected maintainer's resolved repository chain), it is returned directly.
 *
 * When `selectedMaintainers` is `undefined` (context unknown — e.g. a global
 * issue feed), the maintainer set is derived from the issue's first #a tag
 * using `resolveMaintainersFromIssue`. The pubkey is always extractable from
 * the coordinate string itself, so at least one maintainer is known before any
 * 30617 announcement events have been received.
 *
 * Note: the issue author is NOT included — pass `issue.pubkey` separately as
 * `issuePubkey` to the consumer hooks.
 *
 * @param issueId             - The event ID of the issue
 * @param selectedMaintainers - Known maintainer set, or undefined when unknown
 */
export function useIssueMaintainers(
  issueId: string | undefined,
  selectedMaintainers: Set<string> | undefined,
): Set<string> | undefined {
  const store = useEventStore();

  // Subscribe to the issue event only when auto-resolution is needed.
  const issueEvents = use$(() => {
    if (selectedMaintainers !== undefined || !issueId) return undefined;
    return store.timeline([
      { kinds: [ISSUE_KIND], ids: [issueId] },
    ]) as unknown as Observable<NostrEvent[]>;
  }, [issueId, selectedMaintainers, store]);

  if (selectedMaintainers !== undefined) return selectedMaintainers;
  if (!issueEvents || issueEvents.length === 0) return undefined;

  return resolveMaintainersFromIssue(
    issueEvents[0],
    store.getByFilters([{ kinds: [REPO_KIND] }]) as NostrEvent[],
  );
}

// ---------------------------------------------------------------------------
// Subject resolution
// ---------------------------------------------------------------------------

/**
 * Compute the current (effective) subject for an issue from pre-filtered,
 * pre-sorted rename events. The last entry (latest by created_at, then id)
 * wins.
 *
 * @param originalSubject - The subject from the issue event itself
 * @param subjectRenames  - Authorised, sorted rename events from useIssueSubjectRenames
 */
export function resolveCurrentSubject(
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
