import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import type { RelayGroup } from "applesauce-relay";
import { castTimelineStream } from "applesauce-common/observable";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import {
  ISSUE_KIND,
  STATUS_KINDS,
  LABEL_KIND,
  COMMENT_KIND,
  SUBJECT_LABEL_NAMESPACE,
  kindToStatus,
  type IssueStatus,
  type RepoQueryOptions,
} from "@/lib/nip34";
import { ISSUE_LABEL_NAMESPACE } from "@/blueprints/label";
import { Issue } from "@/casts/Issue";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

/**
 * Fetch issues for a repository.
 *
 * Accepts either a single coordinate string or an array of coordinate strings
 * (one per maintainer in the chain). Passing all maintainer coordinates
 * ensures issues tagged against any co-maintainer's announcement are included.
 *
 * Also fetches status events so we can determine current status.
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
): {
  issues: Issue[] | undefined;
  statusMap: Map<string, { status: IssueStatus; event: NostrEvent }>;
  /** issueId → deduplicated labels from NIP-32 kind:1985 events */
  labelsMap: Map<string, string[]>;
  /** issueId → subject-rename events sorted ascending (oldest first) */
  subjectRenamesMap: Map<string, NostrEvent[]>;
} {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  // Normalise to array for consistent filter building
  const coords = repoCoords
    ? Array.isArray(repoCoords)
      ? repoCoords
      : [repoCoords]
    : undefined;

  // The repoRelayGroup instance is stable — use its identity as the dep key.
  // coords changes when the maintainer set grows (new allCoordinates).
  const coordKey = coords?.join(",") ?? "";

  // Fetch issues from relay via the long-lived group subscription.
  // When new relays are added to the group, reverseSwitchMap + WeakMap cache
  // opens a subscription only to the new relay — existing ones are untouched.
  use$(() => {
    if (!coords || coords.length === 0 || !repoRelayGroup) return undefined;
    const issueFilters: Filter[] = [
      { kinds: [ISSUE_KIND], "#a": coords } as Filter,
    ];
    return repoRelayGroup
      .subscription(issueFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [coordKey, repoRelayGroup, store]);

  // Subscribe to issues in store, cast to Issue instances
  const issues = use$(() => {
    if (!coords || coords.length === 0) return undefined;
    const issueFilters: Filter[] = [
      { kinds: [ISSUE_KIND], "#a": coords } as Filter,
    ];
    return store
      .timeline(issueFilters)
      .pipe(castTimelineStream(Issue, castStore)) as unknown as Observable<
      Issue[]
    >;
  }, [coordKey, store]);

  // Fetch statuses from relay via the same group
  use$(() => {
    if (!coords || coords.length === 0 || !repoRelayGroup) return undefined;
    const statusFilters: Filter[] = [
      { kinds: [...STATUS_KINDS], "#a": coords } as Filter,
    ];
    return repoRelayGroup
      .subscription(statusFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [coordKey, repoRelayGroup, store]);

  // Subscribe to statuses in store
  const statusEvents = use$(() => {
    if (!coords || coords.length === 0) return undefined;
    const statusFilters: Filter[] = [
      { kinds: [...STATUS_KINDS], "#a": coords } as Filter,
    ];
    return store.timeline(statusFilters) as unknown as Observable<NostrEvent[]>;
  }, [coordKey, store]);

  // Build status map: issueId -> latest status
  // Memoized so it's only recomputed when statusEvents changes
  const statusMap = useMemo(() => {
    const map = new Map<string, { status: IssueStatus; event: NostrEvent }>();
    if (!statusEvents) return map;
    for (const ev of statusEvents) {
      const rootTag = ev.tags.find(
        ([t, , , marker]) => t === "e" && marker === "root",
      );
      const issueId = rootTag?.[1];
      if (!issueId) continue;

      const existing = map.get(issueId);
      if (!existing || ev.created_at > existing.event.created_at) {
        map.set(issueId, { status: kindToStatus(ev.kind), event: ev });
      }
    }
    return map;
  }, [statusEvents]);

  // Build labels map: issueId -> deduplicated labels from kind:1985 events.
  //
  // No relay fetch here — nip34EssentialsLoader (called by useNip34Loaders in
  // each IssueRow) already batches { kinds: [1985], "#e": [all ids] } across
  // all rendered issues. We just read reactively from the store.
  //
  // The store is queried by the issue ids we already have. The issueIdKey dep
  // means the subscription re-fires when the issue list grows.
  const issueIdKey = issues?.map((i) => i.id).join(",") ?? "";
  const labelEvents = use$(() => {
    if (!issues || issues.length === 0) return undefined;
    const ids = issues.map((i) => i.id);
    const labelFilters: Filter[] = [
      { kinds: [LABEL_KIND], "#e": ids } as Filter,
    ];
    return store.timeline(labelFilters) as unknown as Observable<NostrEvent[]>;
  }, [issueIdKey, store]);

  // Build labels map: issueId -> deduplicated labels from kind:1985 events
  const labelsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!labelEvents) return map;
    for (const ev of labelEvents) {
      const issueId = ev.tags.find(([t]) => t === "e")?.[1];
      if (!issueId) continue;
      const newLabels = ev.tags
        .filter(([t, , ns]) => t === "l" && ns === ISSUE_LABEL_NAMESPACE)
        .map(([, label]) => label);
      if (newLabels.length === 0) continue;
      const existing = map.get(issueId) ?? [];
      map.set(issueId, Array.from(new Set([...existing, ...newLabels])));
    }
    return map;
  }, [labelEvents]);

  // Build subject renames map: issueId -> sorted rename events (ascending)
  // Only kind:1985 events that carry a #subject label are included.
  const subjectRenamesMap = useMemo(() => {
    const map = new Map<string, NostrEvent[]>();
    if (!labelEvents) return map;
    for (const ev of labelEvents) {
      const hasSubjectLabel = ev.tags.some(
        ([t, , ns]) => t === "l" && ns === SUBJECT_LABEL_NAMESPACE,
      );
      if (!hasSubjectLabel) continue;
      const issueId = ev.tags.find(([t]) => t === "e")?.[1];
      if (!issueId) continue;
      const existing = map.get(issueId) ?? [];
      existing.push(ev);
      map.set(issueId, existing);
    }
    // Sort each list ascending by created_at, tiebreak by id
    for (const [id, evs] of map) {
      map.set(
        id,
        evs.sort(
          (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
        ),
      );
    }
    return map;
  }, [labelEvents]);

  return { issues, statusMap, labelsMap, subjectRenamesMap };
}

/**
 * Fetch comments (NIP-22 kind:1111) for a specific issue.
 * Uses the batched commentsLoader so all per-issue calls are combined into
 * a single relay subscription rather than one request per issue.
 *
 * Fetching is handled by useNip34Loaders (called by IssuePage), which batches
 * { kinds: [1111], "#E": [issueId] } and, when useItemAuthorRelays is true,
 * also queries the inbox-only delta relays of the issue author.
 *
 * @param issueId - The event ID of the issue
 */
export function useIssueComments(
  issueId: string | undefined,
): NostrEvent[] | undefined {
  const store = useEventStore();

  return use$(() => {
    if (!issueId) return undefined;
    const filters: Filter[] = [
      { kinds: [COMMENT_KIND], "#E": [issueId] } as Filter,
    ];
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [issueId, store]);
}

/**
 * Fetch status events for a specific issue.
 * Returns the latest status.
 *
 * Status events (kinds 1630-1633) are written by maintainers, so when
 * useItemAuthorRelays is true we query the NIP-65 outbox relays of all
 * maintainers in addition to the repo's declared relays. Kind:10002 events are
 * fetched via indexer relays (purplepag.es etc.) configured in lookupRelays.
 *
 * @param issueId    - The event ID of the issue
 * @param repoRelays - Relay URLs from ResolvedRepo.relays
 * @param options    - Query options including relay hints
 */
export function useIssueStatus(issueId: string | undefined): IssueStatus {
  const store = useEventStore();

  // No relay fetch — nip34EssentialsLoader (called by useNip34Loaders in
  // IssuePage) already batches { kinds: [1630-1633], "#e": [issueId] }.
  // Just read reactively from the store.
  const events = use$(() => {
    if (!issueId) return undefined;
    const filters: Filter[] = [
      { kinds: [...STATUS_KINDS], "#e": [issueId] } as Filter,
    ];
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [issueId, store]);

  if (!events || events.length === 0) return "open";
  const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
  return kindToStatus(sorted[0].kind);
}

/**
 * Return NIP-32 labels (kind:1985, `#t` namespace) for a specific issue.
 *
 * No relay fetch — nip34EssentialsLoader (called by useNip34Loaders in
 * IssueRow / IssuePage) already batches { kinds: [1985], "#e": [issueId] }.
 * We just read reactively from the store.
 *
 * @param issueId - The event ID of the issue
 */
export function useIssueLabels(issueId: string | undefined): string[] {
  const store = useEventStore();

  const events = use$(() => {
    if (!issueId) return undefined;
    const filters: Filter[] = [
      { kinds: [LABEL_KIND], "#e": [issueId] } as Filter,
    ];
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [issueId, store]);

  if (!events || events.length === 0) return [];

  const seen = new Set<string>();
  for (const ev of events) {
    for (const [t, label, ns] of ev.tags) {
      if (t === "l" && ns === ISSUE_LABEL_NAMESPACE && label) {
        seen.add(label);
      }
    }
  }
  return Array.from(seen).sort();
}

/**
 * Return zap receipts (kind:9735) for a specific issue.
 *
 * Fetching is handled by useNip34Loaders (called by IssuePage), which batches
 * { kinds: [7, 9735], "#e": [issueId] } and, when useItemAuthorRelays is true,
 * also queries the inbox-only delta relays of the issue author.
 *
 * @param issueId - The event ID of the issue
 */
export function useIssueZaps(
  issueId: string | undefined,
): NostrEvent[] | undefined {
  const store = useEventStore();

  return use$(() => {
    if (!issueId) return undefined;
    const filters: Filter[] = [{ kinds: [9735], "#e": [issueId] } as Filter];
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [issueId, store]);
}

/**
 * Return all kind:1985 subject-rename events for a specific issue, sorted by
 * created_at ascending (oldest first), with id as a tiebreaker.
 *
 * These are events with:
 *   ["e", issueId]
 *   ["L", "#subject"]
 *   ["l", "<new subject>", "#subject"]
 *
 * Fetching is handled by nip34EssentialsLoader (called by useNip34Loaders),
 * which already batches { kinds: [1985], "#e": [issueId] }.
 *
 * @param issueId - The event ID of the issue
 */
export function useIssueSubjectRenames(
  issueId: string | undefined,
): NostrEvent[] | undefined {
  const store = useEventStore();

  const raw = use$(() => {
    if (!issueId) return undefined;
    const filters: Filter[] = [
      { kinds: [LABEL_KIND], "#e": [issueId] } as Filter,
    ];
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [issueId, store]);

  if (!raw) return undefined;

  // Keep only events that carry a #subject label
  const renames = raw.filter((ev) =>
    ev.tags.some(([t, , ns]) => t === "l" && ns === SUBJECT_LABEL_NAMESPACE),
  );

  // Sort ascending by created_at, tiebreak by id (lexicographic)
  return [...renames].sort(
    (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
  );
}

/**
 * Compute the current (effective) subject for an issue, taking into account
 * any kind:1985 subject-rename events.
 *
 * Priority rules (per spec):
 *   1. Maintainer-authored renames are authoritative; non-maintainer renames
 *      are treated as suggestions. When maintainerPubkeys is provided, only
 *      maintainer renames are considered. When it is omitted (e.g. on the list
 *      page before the maintainer set is resolved), ALL renames are accepted.
 *   2. Among qualifying renames, the latest by created_at wins; id is the
 *      tiebreaker (lexicographic ascending — lower id wins, matching NIP-34
 *      convention).
 *
 * @param originalSubject   - The subject from the issue event itself
 * @param subjectRenames    - Sorted rename events from useIssueSubjectRenames
 * @param maintainerPubkeys - Optional set of authoritative pubkeys
 */
export function resolveCurrentSubject(
  originalSubject: string,
  subjectRenames: NostrEvent[] | undefined,
  maintainerPubkeys?: Set<string>,
): string {
  if (!subjectRenames || subjectRenames.length === 0) return originalSubject;

  // Filter to authoritative renames when the maintainer set is known
  const qualifying =
    maintainerPubkeys && maintainerPubkeys.size > 0
      ? subjectRenames.filter((ev) => maintainerPubkeys.has(ev.pubkey))
      : subjectRenames;

  if (qualifying.length === 0) return originalSubject;

  // Already sorted ascending; the last entry is the winner
  const winner = qualifying[qualifying.length - 1];
  const newSubject = winner.tags.find(
    ([t, , ns]) => t === "l" && ns === SUBJECT_LABEL_NAMESPACE,
  )?.[1];

  return newSubject ?? originalSubject;
}
