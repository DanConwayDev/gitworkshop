import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import type { RelayGroup, IRelay } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";
import { includeMailboxes } from "applesauce-core";
import { of, merge, Observable } from "rxjs";
import { map } from "rxjs/operators";
import {
  liveness,
  nip34ListLoader,
  nip34ThreadItemLoader,
  pool,
} from "@/services/nostr";
import { gitIndexRelays, relayCurationMode } from "@/services/settings";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import type { Filter } from "applesauce-core/helpers";

/** Max healthy inbox relays to take for the item author. */
const MAX_INBOX_RELAYS = 3;

/**
 * Subscribe reactively to a RelayGroup's relay URL list.
 * Re-renders (and re-runs dependent use$() calls) whenever the group gains
 * or loses relays. Returns a stable empty array when group is undefined.
 *
 * relays$ is protected in TypeScript but public at runtime — we cast to
 * access it so we can react to relay additions without polling.
 */
function useRelayGroupUrls(group: RelayGroup | undefined): string[] {
  const urls = use$(() => {
    if (!group) return of([] as string[]);
    return (group as unknown as { relays$: Observable<IRelay[]> }).relays$.pipe(
      map((relays) => relays.map((r) => r.url)),
    );
  }, [group]);
  return urls ?? [];
}

/**
 * Return the relays$ observable for a RelayGroup, or an observable of []
 * when the group is undefined. Used to pass a reactive relay list directly
 * to nip34ThreadItemLoader so it can handle new relays additively without
 * needing to be torn down and recreated.
 */
function relayGroupUrls$(group: RelayGroup | undefined): Observable<string[]> {
  if (!group) return of([] as string[]);
  return (group as unknown as { relays$: Observable<IRelay[]> }).relays$.pipe(
    map((relays) => relays.map((r) => r.url)),
  );
}

/**
 * Minimum number of the author's inbox relays that must already be present in
 * the group before we consider coverage sufficient and skip adding more.
 */
const INBOX_COVERAGE_THRESHOLD = 2;

export interface Nip34ItemLoaderOptions {
  /**
   * When true, also fires nip34ThreadItemLoader to fetch reactions (kind:7)
   * and zaps (kind:9735) on the root item and recursively on each comment.
   * Enable on detail pages (IssuePage / PRPage).
   * Default: false.
   */
  includeThread?: boolean;
  /**
   * When true, also fetches from the NIP-65 inbox relays of the item author
   * when those relays are not already sufficiently covered by the group.
   * Enable on detail pages (IssuePage / PRPage) for completeness.
   * Default: false.
   */
  includeAuthorNip65?: boolean;
}

/**
 * Reactively resolve the NIP-65 inbox relays for a single pubkey that are
 * NOT already sufficiently covered by the repo relay group.
 *
 * Returns [] when coverage is already met or when disabled.
 */
function useAuthorInboxDeltaRelays(
  pubkey: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  enabled: boolean,
): string[] {
  const store = useEventStore();

  const groupRelaySet = new Set(repoRelayGroup?.relays.map((r) => r.url) ?? []);
  const groupRelayKey = [...groupRelaySet].sort().join(",");

  const inboxDeltaRelays = use$(() => {
    if (!enabled || !pubkey) return of([] as string[]);
    return of([{ pubkey }]).pipe(
      includeMailboxes(store, "inbox"),
      ignoreUnhealthyRelaysOnPointers(liveness),
      map((enriched) => {
        const online = new Set(liveness.online);
        const authorInboxRelays = (enriched[0]?.relays ?? [])
          .slice()
          .sort((a, b) => (online.has(a) ? 0 : 1) - (online.has(b) ? 0 : 1));

        const overlapCount = authorInboxRelays.filter((r) =>
          groupRelaySet.has(r),
        ).length;

        if (overlapCount >= INBOX_COVERAGE_THRESHOLD) return [] as string[];

        const seen = new Set<string>(groupRelaySet);
        const delta: string[] = [];
        for (const relay of authorInboxRelays) {
          if (delta.length >= MAX_INBOX_RELAYS) break;
          if (!seen.has(relay)) {
            seen.add(relay);
            delta.push(relay);
          }
        }
        return delta;
      }),
    );
  }, [pubkey, groupRelayKey, enabled, store]);

  return inboxDeltaRelays ?? [];
}

/**
 * Triggers loading for a single NIP-34 item (issue, patch, or PR).
 *
 * Two non-additive levels:
 *
 *   list (always) — essentials (status, labels, deletions) + comments.
 *     Fires nip34ListLoader. Merges automatically with nip34RepoLoader
 *     calls from useIssues / usePRs because both use the same singleton
 *     loader instances — applesauce batches them into one relay subscription.
 *
 *   thread (when includeThread is true) — reactions + zaps on root and
 *     recursively on each comment. Fires nip34ThreadItemLoader. Does NOT
 *     re-fire essentials or comments.
 *
 * NIP-65 author inbox relays: when includeAuthorNip65 is true, both levels
 * are also fired against the delta inbox relays (those not already covered
 * by the group). This is a separate observable with its own subscription —
 * the shared relay group is never mutated.
 *
 * @param itemId         - The event ID of the issue / patch / PR
 * @param repoRelayGroup - The base relay group from useResolvedRepository
 * @param options        - Thread and NIP-65 options
 */
export function useNip34ItemLoader(
  itemId: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  options?: Nip34ItemLoaderOptions,
): void {
  const store = useEventStore();
  const includeThread = options?.includeThread ?? false;

  // Reactive relay list — re-subscribes loaders when the group gains new relays
  const repoRelays = useRelayGroupUrls(repoRelayGroup);
  const repoRelayKey = repoRelays.join(",");

  // ── Repo relay loaders ────────────────────────────────────────────────────

  // List level: essentials + comments (always fires)
  use$(() => {
    if (!itemId || repoRelays.length === 0) return undefined;
    return nip34ListLoader(itemId, repoRelays);
  }, [itemId, repoRelayKey]);

  // Thread level: reactions + zaps on root + recursively on comments.
  // Pass the reactive relays$ observable so the loader handles new relays
  // additively without needing to be torn down and recreated.
  use$(() => {
    if (!itemId || repoRelays.length === 0 || !includeThread) return undefined;
    return nip34ThreadItemLoader(itemId, relayGroupUrls$(repoRelayGroup));
  }, [itemId, repoRelayKey, includeThread, repoRelayGroup]);

  // ── NIP-65 author inbox relay loaders ─────────────────────────────────────
  const authorPubkey = use$(() => {
    if (!itemId || !options?.includeAuthorNip65) return of(undefined);
    return store.event(itemId).pipe(map((ev) => ev?.pubkey));
  }, [itemId, options?.includeAuthorNip65, store]);

  const authorInboxDelta = useAuthorInboxDeltaRelays(
    authorPubkey,
    repoRelayGroup,
    options?.includeAuthorNip65 ?? false,
  );

  const inboxDeltaKey = authorInboxDelta.join(",");

  // List level on inbox delta relays
  use$(() => {
    if (!itemId || authorInboxDelta.length === 0) return undefined;
    return nip34ListLoader(itemId, authorInboxDelta);
  }, [itemId, inboxDeltaKey]);

  // Thread level on inbox delta relays
  use$(() => {
    if (!itemId || authorInboxDelta.length === 0 || !includeThread)
      return undefined;
    return nip34ThreadItemLoader(itemId, authorInboxDelta);
  }, [itemId, inboxDeltaKey, includeThread]);
}

// ---------------------------------------------------------------------------
// Batch loader — fire loaders for multiple item IDs at once
// ---------------------------------------------------------------------------

/**
 * Triggers loading for multiple NIP-34 item IDs simultaneously.
 *
 * Internally calls nip34ListLoader (and optionally nip34ThreadItemLoader)
 * for each ID. Because the singleton loader instances batch all calls within
 * their buffer window, this results in a single merged relay subscription
 * rather than N separate ones.
 *
 * @param itemIds        - Array of event IDs to load
 * @param repoRelayGroup - The base relay group from useResolvedRepository
 * @param options        - Thread and NIP-65 options (applied to all IDs)
 */
export function useNip34ItemLoaderBatch(
  itemIds: string[],
  repoRelayGroup: RelayGroup | undefined,
  options?: Nip34ItemLoaderOptions,
): void {
  const store = useEventStore();
  const includeThread = options?.includeThread ?? false;

  // Reactive relay list — re-subscribes loaders when the group gains new relays
  const repoRelays = useRelayGroupUrls(repoRelayGroup);
  const repoRelayKey = repoRelays.join(",");
  // Stable key for the ID list — re-subscribes only when IDs actually change
  const idsKey = [...itemIds].sort().join(",");

  // List level: essentials + comments for all IDs
  use$(() => {
    if (itemIds.length === 0 || repoRelays.length === 0) return undefined;
    return merge(...itemIds.map((id) => nip34ListLoader(id, repoRelays)));
  }, [idsKey, repoRelayKey]);

  // Thread level: reactions + zaps for all IDs.
  // Pass the reactive relays$ observable so each loader handles new relays
  // additively without needing to be torn down and recreated.
  use$(() => {
    if (itemIds.length === 0 || repoRelays.length === 0 || !includeThread)
      return undefined;
    return merge(
      ...itemIds.map((id) =>
        nip34ThreadItemLoader(id, relayGroupUrls$(repoRelayGroup)),
      ),
    );
  }, [idsKey, repoRelayKey, includeThread, repoRelayGroup]);

  // NIP-65 author inbox relay loading per item
  // (Only fires when includeAuthorNip65 is true — resolves each item's author
  // from the store and loads their inbox delta relays.)
  const authorPubkeys = use$(() => {
    if (!options?.includeAuthorNip65 || itemIds.length === 0)
      return of([] as string[]);
    // Resolve pubkeys from the store synchronously
    const pubkeys = itemIds
      .map(
        (id) =>
          (store.getByFilters([{ ids: [id] }]) as NostrEvent[])[0]?.pubkey,
      )
      .filter((pk): pk is string => !!pk);
    return of([...new Set(pubkeys)]);
  }, [idsKey, options?.includeAuthorNip65, store]);

  const uniquePubkeys = authorPubkeys ?? [];

  // For each unique author pubkey, compute inbox delta relays and load
  // (We reuse useAuthorInboxDeltaRelays for the first pubkey only as a
  // simplification — full multi-author inbox loading is a future enhancement)
  const firstPubkey = uniquePubkeys[0];
  const authorInboxDelta = useAuthorInboxDeltaRelays(
    firstPubkey,
    repoRelayGroup,
    options?.includeAuthorNip65 ?? false,
  );
  const inboxDeltaKey = authorInboxDelta.join(",");

  // List level on inbox delta relays
  use$(() => {
    if (itemIds.length === 0 || authorInboxDelta.length === 0) return undefined;
    return merge(...itemIds.map((id) => nip34ListLoader(id, authorInboxDelta)));
  }, [idsKey, inboxDeltaKey]);

  // Thread level on inbox delta relays
  use$(() => {
    if (itemIds.length === 0 || authorInboxDelta.length === 0 || !includeThread)
      return undefined;
    return merge(
      ...itemIds.map((id) => nip34ThreadItemLoader(id, authorInboxDelta)),
    );
  }, [idsKey, inboxDeltaKey, includeThread]);
}

// ---------------------------------------------------------------------------
// Detail-page loader — shared by useResolvedIssue and useResolvedPR
// ---------------------------------------------------------------------------

/**
 * Fetches a single NIP-34 item's root event from relays and triggers
 * list + thread loading.
 *
 * Shared between useResolvedIssue and useResolvedPR. Both hooks need the same
 * three steps:
 *   1. Fetch root event by ID from repoRelayGroup (or fallback gitIndexRelays)
 *   2. In outbox mode, also fetch from extraRelaysForMaintainerMailboxCoverage
 *   3. Trigger useNip34ItemLoader with includeThread: true
 *
 * @param itemId          - The event ID of the root issue / PR / patch
 * @param repoRelayGroup  - Base relay group from useResolvedRepository
 * @param extraRelaysForMaintainerMailboxCoverage - Delta relay group for outbox mode
 * @param maintainers     - Effective maintainer set (used to derive a stable key)
 * @returns maintainerKey - Stable string key for use in downstream use$() dep arrays
 */
export function useNip34ItemDetailLoader(
  itemId: string | undefined,
  repoRelayGroup: RelayGroup | undefined,
  extraRelaysForMaintainerMailboxCoverage: RelayGroup | undefined,
  maintainers: Set<string> | undefined,
): string {
  const store = useEventStore();
  const curationMode = use$(relayCurationMode);

  // ── 1. Fetch root event by ID from relays ──────────────────────────────
  use$(() => {
    if (!itemId) return undefined;
    const filters: Filter[] = [{ ids: [itemId] }];
    if (repoRelayGroup) {
      return repoRelayGroup
        .subscription(filters, { reconnect: Infinity, resubscribe: Infinity })
        .pipe(onlyEvents(), mapEventsToStore(store));
    }
    return pool
      .subscription(gitIndexRelays.getValue(), filters, {
        reconnect: Infinity,
        resubscribe: Infinity,
      })
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [itemId, repoRelayGroup, store]);

  // ── 2. In outbox mode, also fetch from extra maintainer mailbox relays ──
  use$(() => {
    if (
      !itemId ||
      curationMode !== "outbox" ||
      !extraRelaysForMaintainerMailboxCoverage
    )
      return undefined;
    const filters: Filter[] = [{ ids: [itemId] }];
    return extraRelaysForMaintainerMailboxCoverage
      .subscription(filters, { reconnect: Infinity, resubscribe: Infinity })
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [itemId, curationMode, extraRelaysForMaintainerMailboxCoverage, store]);

  // ── 3. Trigger loading (list + thread) ───────────────────────────────────
  useNip34ItemLoader(itemId, repoRelayGroup, {
    includeThread: true,
    includeAuthorNip65: curationMode === "outbox",
  });

  // Return a stable maintainer key for downstream use$() dep arrays
  return maintainers ? [...maintainers].sort().join(",") : "loading";
}
