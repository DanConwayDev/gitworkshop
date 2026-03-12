import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { castTimelineStream } from "applesauce-common/observable";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import {
  pool,
  nip34CommentsLoader,
  nip34ThreadLoader,
  addressLoader,
} from "@/services/nostr";
import {
  ISSUE_KIND,
  STATUS_KINDS,
  COMMENT_KIND,
  kindToStatus,
  type IssueStatus,
  type RepoQueryOptions,
} from "@/lib/nip34";
import { Issue } from "@/casts/Issue";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import { combineLatest, merge, of } from "rxjs";
import { map } from "rxjs/operators";

/**
 * Build the effective relay list for repo-specific event queries.
 * Union of the repo's declared relays, relay hints from the URL/settings, and
 * any additional NIP-65 outbox relays (when nip65 is enabled).
 * Returns an empty array (no query) if neither is available — announcement
 * discovery via NGIT_RELAYS is handled separately in useResolvedRepository.
 */
function buildRelays(
  repoRelays: string[],
  options: RepoQueryOptions,
  extraRelays: string[] = [],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const r of [...repoRelays, ...options.relayHints, ...extraRelays]) {
    if (!seen.has(r)) {
      seen.add(r);
      result.push(r);
    }
  }
  return result;
}

/**
 * Fetch NIP-65 kind:10002 mailbox events for a set of pubkeys and return
 * their combined outbox relay URLs.
 *
 * When `enabled` is false (or pubkeys is empty) this is a no-op and returns
 * an empty array immediately — existing behaviour is unchanged.
 *
 * Implementation notes:
 * - addressLoader is used to fetch kind:10002 events; it batches requests and
 *   checks the local cache first, so repeated calls are cheap.
 * - eventStore.mailboxes() provides a reactive observable per pubkey; we
 *   combine them so the result updates if any mailbox event arrives later.
 * - The hook returns a stable empty array when disabled so callers can safely
 *   include it in dependency arrays via JSON.stringify.
 */
function useNip65Outboxes(pubkeys: string[], enabled: boolean): string[] {
  const store = useEventStore();
  const pubkeyKey = pubkeys.join(",");

  // Trigger addressLoader for each pubkey's kind:10002 event.
  // This is a side-effect subscription — events land in the store and the
  // reactive mailboxes() observable below picks them up automatically.
  use$(() => {
    if (!enabled || pubkeys.length === 0) return undefined;
    // addressLoader returns an observable per pointer; merge them all so
    // a single subscription triggers fetches for every pubkey.
    const observables = pubkeys.map((pubkey) =>
      addressLoader({ kind: 10002, pubkey }),
    );
    return merge(...observables).pipe(mapEventsToStore(store));
  }, [pubkeyKey, enabled, store]);

  // Reactively read outbox relays from the store for all pubkeys.
  const outboxes = use$(() => {
    if (!enabled || pubkeys.length === 0) return of([] as string[]);
    // Combine mailbox observables for all pubkeys into a single array of
    // all outbox URLs, deduplicated.
    const mailboxObservables = pubkeys.map((pubkey) => store.mailboxes(pubkey));
    return combineLatest(mailboxObservables).pipe(
      map((mailboxList) => {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const mailboxes of mailboxList) {
          for (const relay of mailboxes?.outboxes ?? []) {
            if (!seen.has(relay)) {
              seen.add(relay);
              result.push(relay);
            }
          }
        }
        return result;
      }),
    );
  }, [pubkeyKey, enabled, store]);

  return outboxes ?? [];
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
 * @param repoRelays - Relay URLs from ResolvedRepo.relays (the repo's declared relays)
 * @param options    - Query options including relay hints from the URL/settings
 */
export function useIssues(
  repoCoords: string | string[] | undefined,
  repoRelays: string[],
  options: RepoQueryOptions,
): {
  issues: Issue[] | undefined;
  statusMap: Map<string, { status: IssueStatus; event: NostrEvent }>;
} {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  // NIP-65: fetch outbox relays for all maintainers when enabled.
  // These are additive on top of repoRelays + relayHints.
  const maintainerOutboxes = useNip65Outboxes(
    options.nip65 ? (options.maintainerPubkeys ?? []) : [],
    options.nip65 ?? false,
  );

  const relays = buildRelays(repoRelays, options, maintainerOutboxes);
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
 * When nip65 is true, also queries the NIP-65 outbox relays of the issue
 * author. The issue author is resolved reactively from the store (two-step):
 * the issue event must already be in the store (fetched by IssuePage) before
 * the outbox lookup can proceed. We query the issue author's outboxes rather
 * than individual comment authors because comment authors are not known until
 * comments are already fetched — a chicken-and-egg problem. The issue author
 * is a reliable proxy: they are the most likely person to have commented and
 * their outbox is already needed for other queries on the same page.
 *
 * @param issueId    - The event ID of the issue
 * @param repoRelays - Relay URLs from ResolvedRepo.relays
 * @param options    - Query options including relay hints
 */
export function useIssueComments(
  issueId: string | undefined,
  repoRelays: string[],
  options: RepoQueryOptions,
): NostrEvent[] | undefined {
  const store = useEventStore();

  // Reactively resolve the issue author pubkey from the store.
  // This is available as soon as the issue event lands (fetched by IssuePage).
  const issueAuthorPubkey = use$(() => {
    if (!issueId || !options.nip65) return of(undefined);
    return store.event(issueId).pipe(map((ev) => ev?.pubkey));
  }, [issueId, options.nip65, store]);

  // NIP-65: fetch outbox relays for the issue author when enabled.
  const issueAuthorOutboxes = useNip65Outboxes(
    issueAuthorPubkey ? [issueAuthorPubkey] : [],
    options.nip65 ?? false,
  );

  const relays = buildRelays(repoRelays, options, issueAuthorOutboxes);
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
 * Status events (kinds 1630-1633) are written by maintainers, so when nip65
 * is true we query the NIP-65 outbox relays of all maintainers in addition to
 * the repo's declared relays.
 *
 * @param issueId    - The event ID of the issue
 * @param repoRelays - Relay URLs from ResolvedRepo.relays
 * @param options    - Query options including relay hints
 */
export function useIssueStatus(
  issueId: string | undefined,
  repoRelays: string[],
  options: RepoQueryOptions,
): IssueStatus {
  const store = useEventStore();

  // NIP-65: fetch outbox relays for all maintainers when enabled.
  const maintainerOutboxes = useNip65Outboxes(
    options.nip65 ? (options.maintainerPubkeys ?? []) : [],
    options.nip65 ?? false,
  );

  const relays = buildRelays(repoRelays, options, maintainerOutboxes);
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
 * When nip65 is true, also queries the NIP-65 outbox relays of the issue
 * author. Zap receipts are published by the recipient's lightning node and
 * often land on the recipient's outbox relays; the issue author is the most
 * likely zap recipient. See useIssueComments for the rationale on using the
 * issue author rather than individual zap senders.
 *
 * @param issueId    - The event ID of the issue
 * @param repoRelays - Relay URLs from ResolvedRepo.relays
 * @param options    - Query options including relay hints
 */
export function useIssueZaps(
  issueId: string | undefined,
  repoRelays: string[],
  options: RepoQueryOptions,
): NostrEvent[] | undefined {
  const store = useEventStore();

  // Reactively resolve the issue author pubkey from the store (two-step fetch).
  const issueAuthorPubkey = use$(() => {
    if (!issueId || !options.nip65) return of(undefined);
    return store.event(issueId).pipe(map((ev) => ev?.pubkey));
  }, [issueId, options.nip65, store]);

  // NIP-65: fetch outbox relays for the issue author when enabled.
  const issueAuthorOutboxes = useNip65Outboxes(
    issueAuthorPubkey ? [issueAuthorPubkey] : [],
    options.nip65 ?? false,
  );

  const relays = buildRelays(repoRelays, options, issueAuthorOutboxes);
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
