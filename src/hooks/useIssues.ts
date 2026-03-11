import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { pool } from "@/services/nostr";
import {
  ISSUE_KIND,
  NGIT_RELAYS,
  STATUS_KINDS,
  COMMENT_KIND,
  kindToStatus,
  type IssueStatus,
} from "@/lib/nip34";
import { parseIssue, type IssueData } from "@/casts/Issue";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

/**
 * Fetch issues for a repository coordinate.
 * Also fetches status events so we can determine current status.
 */
export function useIssues(repoCoord: string | undefined): {
  issues: IssueData[] | undefined;
  statusMap: Map<string, { status: IssueStatus; event: NostrEvent }>;
} {
  const store = useEventStore();

  // Issue filters
  const issueFilters: Filter[] | undefined = useMemo(() => {
    if (!repoCoord) return undefined;
    return [{ kinds: [ISSUE_KIND], "#a": [repoCoord] } as Filter];
  }, [repoCoord]);

  const issueFilterKey = JSON.stringify(issueFilters);

  // Fetch issues from relay
  use$(() => {
    if (!issueFilters) return undefined;
    return pool
      .req(NGIT_RELAYS, issueFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [issueFilterKey, store]);

  // Subscribe to issues in store
  const issueEvents = use$(() => {
    if (!issueFilters) return undefined;
    return store.timeline(issueFilters) as unknown as Observable<NostrEvent[]>;
  }, [issueFilterKey, store]);

  // Status filters - fetch status events for this repo
  const statusFilters: Filter[] | undefined = useMemo(() => {
    if (!repoCoord) return undefined;
    return [
      {
        kinds: [...STATUS_KINDS],
        "#a": [repoCoord],
      } as Filter,
    ];
  }, [repoCoord]);

  const statusFilterKey = JSON.stringify(statusFilters);

  // Fetch statuses from relay
  use$(() => {
    if (!statusFilters) return undefined;
    return pool
      .req(NGIT_RELAYS, statusFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [statusFilterKey, store]);

  // Subscribe to statuses in store
  const statusEvents = use$(() => {
    if (!statusFilters) return undefined;
    return store.timeline(statusFilters) as unknown as Observable<NostrEvent[]>;
  }, [statusFilterKey, store]);

  // Build status map: issueId -> latest status
  const statusMap = useMemo(() => {
    const map = new Map<string, { status: IssueStatus; event: NostrEvent }>();
    if (!statusEvents) return map;

    for (const ev of statusEvents) {
      // Status events reference the issue via "e" tag with "root" marker
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

  const issues = useMemo(() => {
    if (!issueEvents) return undefined;
    return issueEvents
      .map(parseIssue)
      .filter((i): i is IssueData => i !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [issueEvents]);

  return { issues, statusMap };
}

/**
 * Fetch comments (NIP-22 kind:1111) for a specific issue.
 */
export function useIssueComments(
  issueId: string | undefined,
): NostrEvent[] | undefined {
  const store = useEventStore();

  const filters: Filter[] | undefined = useMemo(() => {
    if (!issueId) return undefined;
    return [{ kinds: [COMMENT_KIND], "#E": [issueId] } as Filter];
  }, [issueId]);

  const filterKey = JSON.stringify(filters);

  // Fetch from relay
  use$(() => {
    if (!filters) return undefined;
    return pool
      .req(NGIT_RELAYS, filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [filterKey, store]);

  // Subscribe to store
  const events = use$(() => {
    if (!filters) return undefined;
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [filterKey, store]);

  return useMemo(() => {
    if (!events) return undefined;
    return [...events].sort((a, b) => a.created_at - b.created_at);
  }, [events]);
}

/**
 * Fetch status events for a specific issue.
 * Returns the latest status.
 */
export function useIssueStatus(issueId: string | undefined): IssueStatus {
  const store = useEventStore();

  const filters: Filter[] | undefined = useMemo(() => {
    if (!issueId) return undefined;
    return [
      {
        kinds: [...STATUS_KINDS],
        "#e": [issueId],
      } as Filter,
    ];
  }, [issueId]);

  const filterKey = JSON.stringify(filters);

  // Fetch from relay
  use$(() => {
    if (!filters) return undefined;
    return pool
      .req(NGIT_RELAYS, filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [filterKey, store]);

  // Subscribe to store
  const events = use$(() => {
    if (!filters) return undefined;
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [filterKey, store]);

  return useMemo(() => {
    if (!events || events.length === 0) return "open";
    // Find the most recent status event
    const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
    return kindToStatus(sorted[0].kind);
  }, [events]);
}

/**
 * Fetch zap events (kind 9735) for a specific issue.
 */
export function useIssueZaps(
  issueId: string | undefined,
): NostrEvent[] | undefined {
  const store = useEventStore();

  const filters: Filter[] | undefined = useMemo(() => {
    if (!issueId) return undefined;
    return [{ kinds: [9735], "#e": [issueId] } as Filter];
  }, [issueId]);

  const filterKey = JSON.stringify(filters);

  // Fetch from relay
  use$(() => {
    if (!filters) return undefined;
    return pool
      .req(NGIT_RELAYS, filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [filterKey, store]);

  // Subscribe to store
  return use$(() => {
    if (!filters) return undefined;
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [filterKey, store]);
}
