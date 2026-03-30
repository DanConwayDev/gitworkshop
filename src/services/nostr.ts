import { EventStore, mapEventsToStore } from "applesauce-core";
import { persistEventsToCache, relaySet } from "applesauce-core/helpers";
import type { Filter } from "applesauce-core/helpers";
import {
  createAddressLoader,
  createEventLoaderForStore,
  createReactionsLoader,
  createTagValueLoader,
  createZapsLoader,
  DnsIdentityLoader,
} from "applesauce-loaders/loaders";
import { RelayLiveness, RelayPool, onlyEvents } from "applesauce-relay";
import type { RelayGroup } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers";
import type { NostrEvent } from "nostr-tools";
import { verifyEvent } from "nostr-tools";
import {
  Observable,
  merge,
  distinctUntilChanged,
  firstValueFrom,
  of,
} from "rxjs";
import { map, timeout } from "rxjs/operators";
import { MailboxesModel } from "applesauce-core/models";
import { cacheRequest, saveEvents } from "./cache";
import { nip05IdbCache, loadAllNip05FromIdb } from "./nip05IdbCache";
import { extraRelays, lookupRelays } from "./settings";
import { ISSUE_KIND, PR_ROOT_KINDS } from "@/lib/nip34";
import { outboxStore, type RelayGroupResolver } from "./outbox";

/**
 * Global EventStore instance for all Nostr events.
 * This is the central state container for the application.
 */
export const eventStore = new EventStore({
  keepDeleted: false, // Don't keep deleted events
  keepExpired: false, // Don't keep expired events
  keepOldVersions: false, // Only keep latest version of replaceable events
});

// Verify events when they are added to the store
eventStore.verifyEvent = verifyEvent;

// Persist events to the local nostrdb
persistEventsToCache(eventStore, saveEvents);

/**
 * Global RelayPool instance for all relay connections.
 * Use this to query events and publish to relays.
 */
export const pool = new RelayPool();

/**
 * Global relay liveness tracker.
 * Monitors connection health for relays discovered via NIP-65 outbox model so
 * that dead or repeatedly-failing relays are skipped automatically.
 *
 * Repo-declared relays and explicit relay hints bypass liveness filtering —
 * they are authoritative and should always be tried. Only user-discovered
 * outbox relays (kind:10002) are filtered through this tracker.
 */
export const liveness = new RelayLiveness();
liveness.connectToPool(pool);

/**
 * Setup NostrConnectSigner to use the global relay pool.
 * This allows NostrConnectSigner instances to communicate with relays
 * for NIP-46 remote signing.
 */
NostrConnectSigner.pool = pool;

// Inject the pool into the outbox store so it can publish to relays.
// This is done here (after pool is created) to avoid a circular dependency.
outboxStore.pool = pool;

/**
 * Relay group resolver for the outbox store.
 *
 * Resolves a group ID to the current set of relay URLs:
 *   - 64-char hex pubkey → MailboxesModel outboxes (own pubkey) or inboxes (other)
 *   - "30617:<pubkey>:<d>" → repo's declared relays from the EventStore
 *   - Other strings → [] (no dynamic resolution)
 *
 * This is called by outboxStore.reResolveRelayGroups() when relay lists change.
 */
const relayGroupResolver: RelayGroupResolver = async (groupId, eventPubkey) => {
  // 64-char hex pubkey
  if (/^[0-9a-f]{64}$/.test(groupId)) {
    try {
      const mailboxes = await firstValueFrom(
        eventStore
          .model(MailboxesModel, groupId)
          .pipe(timeout({ first: 500, with: () => of(undefined) })),
      );
      if (!mailboxes) return [];
      const isOwn = groupId === eventPubkey;
      const relays = isOwn ? mailboxes.outboxes : mailboxes.inboxes;
      return relays.slice(0, 5);
    } catch {
      return [];
    }
  }

  // Repo coord: "30617:<pubkey>:<d>"
  if (groupId.startsWith("30617:")) {
    const parts = groupId.split(":");
    const pubkey = parts[1];
    const d = parts[2];
    if (!pubkey || !d) return [];
    const repoEvents = eventStore.getByFilters({
      kinds: [30617],
      authors: [pubkey],
      "#d": [d],
    } as Filter);
    const repoEvent = repoEvents[0];
    if (!repoEvent) return [];
    return repoEvent.tags
      .filter(([t]) => t === "relay")
      .map(([, url]) => url)
      .filter(Boolean);
  }

  return [];
};

outboxStore.relayGroupResolver = relayGroupResolver;

/**
 * Watch for changes to the current user's NIP-65 relay list and re-resolve
 * relay groups for any pending outbox items. This ensures that if the user
 * updates their relay list, pending events are sent to any newly-added relays.
 *
 * We track the serialized outbox URL list so we only trigger on actual changes,
 * not on every MailboxesModel emission.
 */
function watchUserMailboxesForOutboxReResolve(pubkey: string): () => void {
  const sub = eventStore
    .model(MailboxesModel, pubkey)
    .pipe(
      map((m) => JSON.stringify([...(m?.outboxes ?? [])].sort())),
      distinctUntilChanged(),
    )
    .subscribe(() => {
      outboxStore.reResolveRelayGroups().catch((err) => {
        console.warn("[outbox] reResolveRelayGroups failed:", err);
      });
    });
  return () => sub.unsubscribe();
}

// Exported so accounts.ts (or App.tsx) can call it when the active account changes.
export { watchUserMailboxesForOutboxReResolve };

/**
 * Publish an event to the configured relays.
 *
 * This is the low-level publish used by the ActionRunner for built-in
 * applesauce actions (UpdateProfile, AddOutboxRelay, etc.). It publishes to
 * the union of the provided relays and the global extraRelays fallback, and
 * records the attempt in the outbox store for retry and UI display.
 *
 * For NIP-34 events (issues, status changes, renames) use the dedicated
 * Action functions in src/actions/nip34.ts which resolve the correct relay
 * groups (user outbox + repo relays + notification inboxes) automatically.
 *
 * @param event  - The signed Nostr event to publish
 * @param relays - Optional relay URLs; falls back to extraRelays if omitted
 */
export async function publish(
  event: NostrEvent,
  relays?: string[],
): Promise<void> {
  // Add to local store immediately for optimistic updates
  eventStore.add(event);

  const targetRelays = relaySet(extraRelays.getValue(), relays);
  await outboxStore.publish(event, { relays: [...targetRelays] });
}

/**
 * Create unified event loader for the EventStore.
 * This automatically loads events that are referenced but not in the store yet.
 *
 * Features:
 * - Automatic batching of event requests
 * - Follows relay hints from events
 * - Checks IndexedDB cache first
 * - Queries lookup relays for missing events
 */
export const eventLoader = createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: lookupRelays.getValue(),
  extraRelays: extraRelays,
  followRelayHints: true,
  bufferTime: 1000, // Batch requests within 1 second
});

/**
 * Loader for addressable events (NIP-33).
 * Used for loading articles, profiles, and other replaceable events.
 */
export const addressLoader = createAddressLoader(pool, {
  cacheRequest,
  extraRelays: extraRelays,
  eventStore,
  lookupRelays: lookupRelays.getValue(),
});

/**
 * Loader for reactions (kind 7).
 * Efficiently loads and caches reactions for events.
 */
export const reactionsLoader = createReactionsLoader(pool, {
  cacheRequest,
  eventStore,
});

/** Create loader for loading zaps for other events */
export const zapsLoader = createZapsLoader(pool, {
  cacheRequest,
  extraRelays,
  eventStore,
});

/**
 * Loader for NIP-05 DNS identity lookups.
 * Results are persisted to IndexedDB (ngitstack / nip05-identities) so that
 * verified identities survive page reloads. Expiry is set to 30 days so
 * stale entries are re-verified after a month.
 */
export const dnsIdentityLoader = new DnsIdentityLoader(nip05IdbCache);
dnsIdentityLoader.expiration = 60 * 60 * 24 * 30; // 30 days in seconds

// Warm the in-memory identity map from IDB on startup.
// DnsIdentityLoader.loadIdentity() reads IDB but does NOT write back to the
// in-memory map (this.identities), so getIdentity() would always miss on a
// fresh page load even when IDB has data. Loading all entries upfront ensures
// the synchronous getIdentity() check in useRepoPath hits on the first render.
loadAllNip05FromIdb().then((entries) => {
  for (const [address, identity] of Object.entries(entries)) {
    dnsIdentityLoader.identities.set(address, identity);
  }
});

// ---------------------------------------------------------------------------
// NIP-34 two-tier loaders for Issues, Patches, and PRs
//
// Each tier is a SINGLE loader instance per tag name, so all per-item calls
// within the buffer window are collapsed into one relay subscription.
//
// Tier 1 — essentials (#e tag, bufferTime: 100ms)
//   One subscription covers status (1630-1633), labels (1985), and deletions
//   (5) for every item on the page: { kinds: [...], "#e": ["id1","id2",...] }
//
// Tier 2 — thread (#E and #e tags, bufferTime: 500ms)
//   Comments use the uppercase #E root tag (NIP-22), so they need their own
//   loader. Reactions (7) and zaps (9735) share a single #e loader.
//   The longer buffer ensures essentials always land first.
// ---------------------------------------------------------------------------

const NIP34_ESSENTIALS_BUFFER = 100;
const NIP34_THREAD_BUFFER = 500;

/**
 * Tier 1 — essentials loader.
 * Fetches status (1630-1633), NIP-32 labels (1985), and deletion requests (5)
 * for issues/patches/PRs in a single batched relay subscription per buffer
 * window.
 */
export const nip34EssentialsLoader = createTagValueLoader(pool, "e", {
  cacheRequest,
  eventStore,
  kinds: [1630, 1631, 1632, 1633, 1985, 5],
  bufferTime: NIP34_ESSENTIALS_BUFFER,
});

/**
 * Tier 2 — thread loader for NIP-22 comments (kind 1111).
 * Uses the uppercase `E` root tag, so it needs its own loader instance
 * separate from the `#e` thread loader.
 */
export const nip34CommentsLoader = createTagValueLoader(pool, "E", {
  cacheRequest,
  eventStore,
  kinds: [1111, 1619],
  bufferTime: NIP34_THREAD_BUFFER,
});

/**
 * Tier 2 — thread loader for reactions (7) and zaps (9735).
 * Both use the lowercase `#e` tag, so they share one loader and one
 * batched relay subscription.
 */
export const nip34ThreadLoader = createTagValueLoader(pool, "e", {
  cacheRequest,
  eventStore,
  kinds: [7, 9735],
  bufferTime: NIP34_THREAD_BUFFER,
});

// ---------------------------------------------------------------------------
// NIP-34 observable factories
//
// These are pure RxJS observable factories — no React, no hooks. They are
// consumed by React hooks via use$(), which handles subscription lifecycle.
//
// Two factories cover the three loading tiers:
//
//   nip34RepoLoader   — repo level: subscribes to all items for a set of repo
//                       coordinates and pipes each newly discovered item ID
//                       into nip34EssentialsLoader. Called from useIssues /
//                       usePRs. seenIds in the closure ensures each ID is only
//                       submitted to the loader once per subscription lifetime.
//                       Closes and resets when the component unmounts (e.g.
//                       navigating away from the repo).
//
//   nip34ItemLoader   — item level: fires loader tiers for a single known item
//                       ID. Tiers are additive — calling with a higher tier
//                       fires any tiers not yet seen without re-firing lower
//                       ones. seenTiers in the closure prevents duplicate
//                       relay requests within the same subscription lifetime.
//                       Separate instances for repo relays vs inbox delta
//                       relays keep relay-group dedup independent.
//
// Filter merging: because nip34EssentialsLoader / nip34CommentsLoader /
// nip34ThreadLoader are singleton instances, calls from nip34RepoLoader and
// nip34ItemLoader that arrive within the same buffer window are automatically
// merged into a single relay subscription by applesauce — even across issues
// and PRs.
// ---------------------------------------------------------------------------

/** All root item kinds tracked at the repo level (issues + PR root kinds). */
const REPO_ITEM_KINDS = [ISSUE_KIND, ...PR_ROOT_KINDS] as const;

/**
 * Repo-level observable factory.
 *
 * Subscribes to all NIP-34 root items (issues + PR/patch roots) for the given
 * repository coordinates via the relay group. For each newly discovered item
 * ID, calls nip34EssentialsLoader so status, labels, and deletion events are
 * fetched and written into the EventStore.
 *
 * Deduplication: a seenIds Set in the closure ensures each item ID is
 * submitted to the loaders exactly once, regardless of how many times the
 * relay re-delivers the root event. The set is fresh per subscription —
 * navigating away and back creates a new observable with a new set,
 * triggering a fresh fetch.
 *
 * Both essentials and comments are fired immediately for each discovered item.
 * Because nip34EssentialsLoader and nip34CommentsLoader are singleton
 * instances backed by batchLoader, all per-item calls within each loader's
 * bufferTime window are collapsed into a single relay subscription — so N
 * items produce one essentials REQ and one comments REQ, not 2N REQs.
 * Calls from nip34ItemLoader (detail pages) that arrive within the same
 * window are merged into the same subscriptions automatically.
 *
 * @param coords     - Sorted array of repo coordinate strings
 * @param relayGroup - Relay group from useResolvedRepository
 */
export function nip34RepoLoader(
  coords: string[],
  relayGroup: RelayGroup,
): Observable<NostrEvent> {
  return new Observable<NostrEvent>((subscriber) => {
    const seenIds = new Set<string>();
    const relayUrls = relayGroup.relays.map((r) => r.url);

    const sub = relayGroup
      .subscription([{ kinds: [...REPO_ITEM_KINDS], "#a": coords } as Filter])
      .pipe(onlyEvents(), mapEventsToStore(eventStore))
      .subscribe({
        next: (event) => {
          const ev = event as NostrEvent;
          if (!seenIds.has(ev.id)) {
            seenIds.add(ev.id);
            // These per-item calls are batched by the singleton loader
            // instances: all IDs pushed within the bufferTime window are
            // collapsed into a single relay subscription automatically.
            nip34EssentialsLoader({
              value: ev.id,
              relays: relayUrls,
            }).subscribe(subscriber);
            nip34CommentsLoader({
              value: ev.id,
              relays: relayUrls,
            }).subscribe(subscriber);
          }
        },
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });

    return () => sub.unsubscribe();
  });
}

/**
 * The loading tier for a single NIP-34 item.
 *
 * - essentials: status (1630-1633), labels (1985), deletions (5)
 * - comments:   essentials + NIP-22 comments (1111)
 * - thread:     comments + reactions (7) + zaps (9735)
 */
export type Nip34ItemTier = "essentials" | "comments" | "thread";

/**
 * Item-level observable factory.
 *
 * Merges the appropriate singleton loader observables for a single known item
 * ID at the requested tier. Tiers are additive:
 *
 *   essentials  →  nip34EssentialsLoader only
 *   comments    →  essentials + nip34CommentsLoader
 *   thread      →  comments  + nip34ThreadLoader (reactions + zaps)
 *
 * Tier upgrade / deduplication: the hook layer (useNip34ItemLoader) manages
 * which tiers have already been subscribed via separate use$() calls keyed on
 * the tier. When the user navigates to a higher-tier page (e.g. list → detail)
 * only the new tier's use$() fires — lower tiers remain open and are not
 * re-subscribed. On navigation away from the repo, all use$() calls
 * unsubscribe and the next visit starts fresh.
 *
 * Relay-group independence: pass repo relays and inbox-delta relays as
 * separate nip34ItemLoader calls so each has its own subscription and
 * deduplication is independent per relay set.
 *
 * Filter merging: because nip34EssentialsLoader / nip34CommentsLoader /
 * nip34ThreadLoader are singleton instances, concurrent calls from multiple
 * components within the same buffer window are merged into a single relay
 * subscription automatically.
 *
 * @param itemId   - The event ID of the issue / patch / PR
 * @param relays   - Relay URLs to query
 * @param tier     - The desired loading tier
 */
export function nip34ItemLoader(
  itemId: string,
  relays: string[],
  tier: Nip34ItemTier,
): Observable<NostrEvent> {
  const observables: Observable<NostrEvent>[] = [
    nip34EssentialsLoader({ value: itemId, relays }),
  ];

  if (tier === "comments" || tier === "thread") {
    observables.push(nip34CommentsLoader({ value: itemId, relays }));
  }

  if (tier === "thread") {
    observables.push(nip34ThreadLoader({ value: itemId, relays }));
  }

  return merge(...observables);
}
