import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { includeMailboxes, mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import type { RelayGroup } from "applesauce-relay";
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";
import { castTimelineStream } from "applesauce-common/observable";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import {
  pool,
  liveness,
  nip34CommentsLoader,
  nip34ThreadLoader,
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

/** Max healthy mailbox relays to take per user when building NIP-65 relay lists. */
const MAX_MAILBOX_RELAYS_PER_USER = 3;

/**
 * Flatten a liveness-filtered list of ProfilePointers into a deduplicated
 * relay URL array, capped at MAX_MAILBOX_RELAYS_PER_USER per pointer.
 *
 * Already-connected relays (liveness.online) are sorted to the front of each
 * pointer's relay list so we reuse open connections before opening new ones.
 *
 * @param enriched  - ProfilePointers with relays already filtered by liveness
 * @param exclude   - Relay URLs to skip (e.g. repo relays already queried)
 */
function flattenMailboxRelays(
  enriched: { pubkey: string; relays?: string[] }[],
  exclude: ReadonlySet<string> = new Set(),
): string[] {
  const online = new Set(liveness.online);
  const seen = new Set<string>(exclude);
  const result: string[] = [];
  for (const pointer of enriched) {
    const relays = (pointer.relays ?? []).slice().sort((a, b) => {
      // Online relays first, then unknown/offline-but-healthy
      const aOnline = online.has(a) ? 0 : 1;
      const bOnline = online.has(b) ? 0 : 1;
      return aOnline - bOnline;
    });
    let count = 0;
    for (const relay of relays) {
      if (count >= MAX_MAILBOX_RELAYS_PER_USER) break;
      if (!seen.has(relay)) {
        seen.add(relay);
        result.push(relay);
      }
      count++;
    }
  }
  return result;
}
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import { of } from "rxjs";
import { map } from "rxjs/operators";

/**
 * Fetch NIP-65 relay URLs for a set of pubkeys and return them as a flat
 * deduplicated array, filtered by liveness and capped per user.
 *
 * @param type - "outbox" for events the user *wrote* (issues, status, announcements)
 *               "inbox"  for events *directed at* the user (comments, zaps, reactions)
 *
 * Uses `includeMailboxes(eventStore, type)` — the canonical Applesauce operator
 * for mailbox discovery. Internally calls `store.replaceable({ kind: 10002, pubkey })`
 * for each pubkey via `ReplaceableModel`. When the event is not yet in the store,
 * `ReplaceableModel` implicitly triggers a fetch via `store.eventLoader` — a
 * unified loader (`createEventLoaderForStore`) that routes replaceable pointers
 * to `createAddressLoader`, which fetches via `lookupRelays` (purplepag.es,
 * index.hzrd149.com, indexer.coracle.social). The fetch only fires if
 * `store.eventLoader` is wired up (it is, in nostr.ts).
 *
 * Reactivity: `combineLatest` over N `store.replaceable()` subscriptions means
 * any arriving kind:10002 event causes a re-emission → `relays` updates →
 * `relayKey` changes → the issue/status fetch `use$` re-subscribes with the
 * expanded relay list. Scoped to the specific pubkeys passed in — no broad
 * subscription.
 *
 * New maintainers: `pubkeyKey` (joined pubkeys) is in the dep array, so when
 * `RepositoryModel` discovers a new co-maintainer and `maintainerSet` grows,
 * the observable is recreated with the full new set. Already-resolved kind:10002
 * events re-emit synchronously from the store; new ones trigger fresh fetches.
 * Full re-subscription on each growth step, but maintainer counts are small
 * (typically 1–5) so this is not a performance concern.
 *
 * When `enabled` is false (or pubkeys is empty) returns an empty array
 * immediately — existing behaviour is unchanged.
 */
function useNip65Relays(
  pubkeys: string[],
  enabled: boolean,
  type: "inbox" | "outbox" = "outbox",
): string[] {
  const store = useEventStore();
  const pubkeyKey = pubkeys.join(",");

  const relays = use$(() => {
    if (!enabled || pubkeys.length === 0) return of([] as string[]);
    const pointers = pubkeys.map((pubkey) => ({ pubkey }));
    return of(pointers).pipe(
      includeMailboxes(store, type),
      ignoreUnhealthyRelaysOnPointers(liveness),
      map((enriched) => flattenMailboxRelays(enriched)),
    );
  }, [pubkeyKey, enabled, type, store]);

  return relays ?? [];
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
 * When nip65 is true, also queries the NIP-65 outbox relays of all
 * maintainers. Kind:10002 events are fetched via indexer relays (purplepag.es
 * etc.) configured in lookupRelays — no manual relay hints needed.
 *
 * @param repoCoords - Coordinate string(s) for the repository
 * @param repoRelays - Relay URLs from ResolvedRepo.relays (the repo's declared relays)
 * @param options    - Query options including relay hints from the URL/settings
 */
export function useIssues(
  repoCoords: string | string[] | undefined,
  group: RelayGroup | undefined,
  options: RepoQueryOptions,
): {
  issues: Issue[] | undefined;
  statusMap: Map<string, { status: IssueStatus; event: NostrEvent }>;
} {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  // NIP-65: fetch outbox relays for all maintainers when enabled and add them
  // to the group. The group already contains repo-declared relays (added by
  // useResolvedRepository). Outbox relays are additive — group.add() is
  // idempotent so already-present relays are skipped.
  const maintainerOutboxes = useNip65Relays(
    options.nip65 ? (options.maintainerPubkeys ?? []) : [],
    options.nip65 ?? false,
    "outbox",
  );

  // Add newly-resolved outbox relays to the group without tearing down
  // existing subscriptions.
  useMemo(() => {
    if (!group) return;
    for (const url of maintainerOutboxes) {
      const relay = pool.relay(url);
      if (!group.has(relay)) group.add(relay);
    }
  }, [group, maintainerOutboxes.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Normalise to array for consistent filter building
  const coords = repoCoords
    ? Array.isArray(repoCoords)
      ? repoCoords
      : [repoCoords]
    : undefined;

  // The group instance is stable — use its identity as the dep key.
  // coords changes when the maintainer set grows (new allCoordinates).
  const coordKey = coords?.join(",") ?? "";

  // Fetch issues from relay via the long-lived group subscription.
  // When new relays are added to the group, reverseSwitchMap + WeakMap cache
  // opens a subscription only to the new relay — existing ones are untouched.
  use$(() => {
    if (!coords || coords.length === 0 || !group) return undefined;
    const issueFilters: Filter[] = [
      { kinds: [ISSUE_KIND], "#a": coords } as Filter,
    ];
    return group
      .subscription(issueFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [coordKey, group, store]);

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
    if (!coords || coords.length === 0 || !group) return undefined;
    const statusFilters: Filter[] = [
      { kinds: [...STATUS_KINDS], "#a": coords } as Filter,
    ];
    return group
      .subscription(statusFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [coordKey, group, store]);

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

  return { issues, statusMap };
}

/**
 * Fetch comments (NIP-22 kind:1111) for a specific issue.
 * Uses the batched commentsLoader so all per-issue calls are combined into
 * a single relay subscription rather than one request per issue.
 *
 * When nip65 is true, also queries the NIP-65 inbox relays of the issue
 * author. Comments are directed at the author so they land on their inbox
 * relays. The issue author pubkey is resolved reactively from the store
 * (two-step): store.event(issueId) emits once the issue event is in the
 * store (fetched by IssuePage or via store.eventLoader fallback), then
 * useNip65Relays fetches the author's kind:10002 via store.eventLoader →
 * createAddressLoader → lookupRelays. We use the issue author rather than
 * individual comment authors because comment authors are unknown until
 * comments are already fetched — a chicken-and-egg problem.
 *
 * The fetch is two-phase: initial call uses repoRelays + relayHints; once
 * the kind:10002 arrives, filterKey changes and the loader re-fires with
 * the inbox relays added. Already-fetched events are deduplicated by the
 * loader's eventStore filter so no duplicates land in the store.
 *
 * @param issueId    - The event ID of the issue
 * @param repoRelays - Relay URLs from ResolvedRepo.relays
 * @param options    - Query options including relay hints
 */
export function useIssueComments(
  issueId: string | undefined,
  group: RelayGroup | undefined,
  options: RepoQueryOptions,
): NostrEvent[] | undefined {
  const store = useEventStore();

  // Reactively resolve the issue author pubkey from the store.
  // This is available as soon as the issue event lands (fetched by IssuePage).
  const issueAuthorPubkey = use$(() => {
    if (!issueId || !options.nip65) return of(undefined);
    return store.event(issueId).pipe(map((ev) => ev?.pubkey));
  }, [issueId, options.nip65, store]);

  // NIP-65: fetch inbox relays for the issue author when enabled.
  // Comments are directed at the author so they land on their inbox relays.
  const issueAuthorInboxes = useNip65Relays(
    issueAuthorPubkey ? [issueAuthorPubkey] : [],
    options.nip65 ?? false,
    "inbox",
  );

  // Add author inbox relays to the group — idempotent, no teardown.
  useMemo(() => {
    if (!group) return;
    for (const url of issueAuthorInboxes) {
      const relay = pool.relay(url);
      if (!group.has(relay)) group.add(relay);
    }
  }, [group, issueAuthorInboxes.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Relay list for the loader: group's current relays + any inbox relays
  // (group may not yet contain inbox relays if add() just fired this render)
  const relays = group
    ? [...new Set([...group.relays.map((r) => r.url), ...issueAuthorInboxes])]
    : issueAuthorInboxes;
  const filterKey = JSON.stringify({
    issueId,
    relays: relays.sort(),
    type: "comments",
  });

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
  }, [issueId, store]);
}

/**
 * Fetch status events for a specific issue.
 * Returns the latest status.
 *
 * Status events (kinds 1630-1633) are written by maintainers, so when nip65
 * is true we query the NIP-65 outbox relays of all maintainers in addition to
 * the repo's declared relays. Kind:10002 events are fetched via indexer relays
 * (purplepag.es etc.) configured in lookupRelays.
 *
 * @param issueId    - The event ID of the issue
 * @param repoRelays - Relay URLs from ResolvedRepo.relays
 * @param options    - Query options including relay hints
 */
export function useIssueStatus(
  issueId: string | undefined,
  group: RelayGroup | undefined,
  options: RepoQueryOptions,
): IssueStatus {
  const store = useEventStore();

  // NIP-65: fetch outbox relays for all maintainers when enabled.
  // Status events are written by maintainers so their outbox relays are correct.
  const maintainerOutboxes = useNip65Relays(
    options.nip65 ? (options.maintainerPubkeys ?? []) : [],
    options.nip65 ?? false,
    "outbox",
  );

  // Add outbox relays to the group — idempotent, no teardown.
  useMemo(() => {
    if (!group) return;
    for (const url of maintainerOutboxes) {
      const relay = pool.relay(url);
      if (!group.has(relay)) group.add(relay);
    }
  }, [group, maintainerOutboxes.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch from relay via the long-lived group
  use$(() => {
    if (!issueId || !group) return undefined;
    const filters: Filter[] = [
      { kinds: [...STATUS_KINDS], "#e": [issueId] } as Filter,
    ];
    return group
      .subscription(filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [issueId, group, store]);

  // Subscribe to store
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
 * Fetch zap receipts (kind 9735) for a specific issue.
 * Uses the batched issueZapsLoader so all per-issue calls are combined into
 * a single relay subscription rather than one request per issue.
 *
 * When nip65 is true, also queries the NIP-65 inbox relays of the issue
 * author. Zap receipts are published by the recipient's lightning node and
 * land on the recipient's inbox relays; the issue author is the most likely
 * zap recipient. See useIssueComments for the full two-phase fetch rationale
 * and why the issue author is used rather than individual zap senders.
 *
 * @param issueId    - The event ID of the issue
 * @param repoRelays - Relay URLs from ResolvedRepo.relays
 * @param options    - Query options including relay hints
 */
export function useIssueZaps(
  issueId: string | undefined,
  group: RelayGroup | undefined,
  options: RepoQueryOptions,
): NostrEvent[] | undefined {
  const store = useEventStore();

  // Reactively resolve the issue author pubkey from the store (two-step fetch).
  const issueAuthorPubkey = use$(() => {
    if (!issueId || !options.nip65) return of(undefined);
    return store.event(issueId).pipe(map((ev) => ev?.pubkey));
  }, [issueId, options.nip65, store]);

  // NIP-65: fetch inbox relays for the issue author when enabled.
  // Zap receipts are sent to the recipient so they land on their inbox relays.
  const issueAuthorInboxes = useNip65Relays(
    issueAuthorPubkey ? [issueAuthorPubkey] : [],
    options.nip65 ?? false,
    "inbox",
  );

  // Add author inbox relays to the group — idempotent, no teardown.
  useMemo(() => {
    if (!group) return;
    for (const url of issueAuthorInboxes) {
      const relay = pool.relay(url);
      if (!group.has(relay)) group.add(relay);
    }
  }, [group, issueAuthorInboxes.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const relays = group
    ? [...new Set([...group.relays.map((r) => r.url), ...issueAuthorInboxes])]
    : issueAuthorInboxes;
  const filterKey = JSON.stringify({
    issueId,
    relays: relays.sort(),
    type: "zaps",
  });

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
  }, [issueId, store]);
}
