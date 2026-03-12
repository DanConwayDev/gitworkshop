import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { castTimelineStream } from "applesauce-common/observable";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import { pool, nip34CommentsLoader, nip34ThreadLoader } from "@/services/nostr";
import {
  ISSUE_KIND,
  NGIT_RELAYS,
  STATUS_KINDS,
  COMMENT_KIND,
  kindToStatus,
  type IssueStatus,
} from "@/lib/nip34";
import { Issue } from "@/casts/Issue";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

/** Resolve relay list: use repo relays when available, fall back to NGIT_RELAYS */
function resolveRelays(relays: string[] | undefined): string[] {
  return relays && relays.length > 0 ? relays : NGIT_RELAYS;
}

/**
 * Fetch issues for a repository.
 *
 * Accepts either a single coordinate string or an array of coordinate strings
 * (one per maintainer in the chain). Passing all maintainer coordinates
 * ensures issues tagged against any co-maintainer's announcement are included.
 *
 * Also fetches status events so we can determine current status.
 *
 * @param repoCoords - Coordinate string(s) for the repository
 * @param repoRelays - Relay URLs from the ResolvedRepo; falls back to NGIT_RELAYS
 */
export function useIssues(
  repoCoords: string | string[] | undefined,
  repoRelays?: string[],
): {
  issues: Issue[] | undefined;
  statusMap: Map<string, { status: IssueStatus; event: NostrEvent }>;
} {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  const relays = resolveRelays(repoRelays);
  const relayKey = relays.join(",");

  // Normalise to array for consistent filter building
  const coords = repoCoords
    ? Array.isArray(repoCoords)
      ? repoCoords
      : [repoCoords]
    : undefined;

  const issueFilterKey = JSON.stringify({ coords, relayKey });

  // Fetch issues from relay — one subscription covers all maintainer coords
  use$(() => {
    if (!coords || coords.length === 0) return undefined;
    const issueFilters: Filter[] = [
      { kinds: [ISSUE_KIND], "#a": coords } as Filter,
    ];
    return pool
      .req(relays, issueFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [issueFilterKey, store]);

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
  }, [issueFilterKey, store]);

  const statusFilterKey = JSON.stringify({ coords, relayKey, type: "status" });

  // Fetch statuses from relay
  use$(() => {
    if (!coords || coords.length === 0) return undefined;
    const statusFilters: Filter[] = [
      { kinds: [...STATUS_KINDS], "#a": coords } as Filter,
    ];
    return pool
      .req(relays, statusFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [statusFilterKey, store]);

  // Subscribe to statuses in store
  const statusEvents = use$(() => {
    if (!coords || coords.length === 0) return undefined;
    const statusFilters: Filter[] = [
      { kinds: [...STATUS_KINDS], "#a": coords } as Filter,
    ];
    return store.timeline(statusFilters) as unknown as Observable<NostrEvent[]>;
  }, [statusFilterKey, store]);

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

  return { issues, statusMap };
}

/**
 * Fetch comments (NIP-22 kind:1111) for a specific issue.
 * Uses the batched commentsLoader so all per-issue calls are combined into
 * a single relay subscription rather than one request per issue.
 *
 * @param issueId  - The event ID of the issue
 * @param repoRelays - Relay URLs from the ResolvedRepo; falls back to NGIT_RELAYS
 */
export function useIssueComments(
  issueId: string | undefined,
  repoRelays?: string[],
): NostrEvent[] | undefined {
  const store = useEventStore();

  const relays = resolveRelays(repoRelays);
  const filterKey = JSON.stringify({ issueId, relays, type: "comments" });

  // Trigger batched fetch via loader — events land in the store automatically
  use$(() => {
    if (!issueId) return undefined;
    return nip34CommentsLoader({ value: issueId, relays });
  }, [filterKey]);

  // Read reactively from the store
  return use$(() => {
    if (!issueId) return undefined;
    const filters: Filter[] = [
      { kinds: [COMMENT_KIND], "#E": [issueId] } as Filter,
    ];
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [filterKey, store]);
}

/**
 * Fetch status events for a specific issue.
 * Returns the latest status.
 *
 * @param issueId  - The event ID of the issue
 * @param repoRelays - Relay URLs from the ResolvedRepo; falls back to NGIT_RELAYS
 */
export function useIssueStatus(
  issueId: string | undefined,
  repoRelays?: string[],
): IssueStatus {
  const store = useEventStore();

  const relays = resolveRelays(repoRelays);
  const filterKey = JSON.stringify({ issueId, relays, type: "issueStatus" });

  // Fetch from relay
  use$(() => {
    if (!issueId) return undefined;
    const filters: Filter[] = [
      { kinds: [...STATUS_KINDS], "#e": [issueId] } as Filter,
    ];
    return pool
      .req(relays, filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [filterKey, store]);

  // Subscribe to store
  const events = use$(() => {
    if (!issueId) return undefined;
    const filters: Filter[] = [
      { kinds: [...STATUS_KINDS], "#e": [issueId] } as Filter,
    ];
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [filterKey, store]);

  if (!events || events.length === 0) return "open";
  const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
  return kindToStatus(sorted[0].kind);
}

/**
 * Fetch zap receipts (kind 9735) for a specific issue.
 * Uses the batched issueZapsLoader so all per-issue calls are combined into
 * a single relay subscription rather than one request per issue.
 *
 * @param issueId  - The event ID of the issue
 * @param repoRelays - Relay URLs from the ResolvedRepo; falls back to NGIT_RELAYS
 */
export function useIssueZaps(
  issueId: string | undefined,
  repoRelays?: string[],
): NostrEvent[] | undefined {
  const store = useEventStore();

  const relays = resolveRelays(repoRelays);
  const filterKey = JSON.stringify({ issueId, relays, type: "zaps" });

  // Trigger batched fetch via loader — events land in the store automatically
  use$(() => {
    if (!issueId) return undefined;
    return nip34ThreadLoader({ value: issueId, relays });
  }, [filterKey]);

  // Read reactively from the store
  return use$(() => {
    if (!issueId) return undefined;
    const filters: Filter[] = [{ kinds: [9735], "#e": [issueId] } as Filter];
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [filterKey, store]);
}
