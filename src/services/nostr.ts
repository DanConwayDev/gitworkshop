import { EventStore, mapEventsToStore } from "applesauce-core";
import { persistEventsToCache, relaySet } from "applesauce-core/helpers";
import type { Filter } from "applesauce-core/helpers";
import {
  createAddressLoader,
  createEventLoaderForStore,
  createReactionsLoader,
  createZapsLoader,
  DnsIdentityLoader,
} from "applesauce-loaders/loaders";
import { RelayLiveness, RelayPool, onlyEvents } from "applesauce-relay";
import type { RelayGroup, IRelay } from "applesauce-relay";
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
import { ISSUE_KIND, PR_ROOT_KINDS, LEGACY_REPLY_KINDS } from "@/lib/nip34";
import { Repository, isValidRepository } from "@/casts/Repository";
import {
  createPaginatedTagValueLoader,
  type PaginatedTagValueResponse,
} from "@/lib/tagValuePaginatedLoader";
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
    if (!repoEvent || !isValidRepository(repoEvent)) return [];
    return new Repository(repoEvent, eventStore).relays;
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
      // Pass the pubkey so only items referencing this user's relay group are re-resolved
      outboxStore.reResolveRelayGroups(pubkey).catch((err) => {
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
 * @param event       - The signed Nostr event to publish
 * @param relays      - Optional relay URLs; falls back to extraRelays if omitted.
 *                      When provided by the ActionRunner these are the user's
 *                      NIP-65 outbox relays and are stored under the "Outbox"
 *                      group label in the outbox store.
 * @param extraGroups - Additional named relay groups to publish to alongside
 *                      the primary relay set (e.g. "User Index Relays").
 */
export async function publish(
  event: NostrEvent,
  relays?: string[],
  extraGroups?: Record<string, string[]>,
): Promise<void> {
  // Add to local store immediately for optimistic updates
  eventStore.add(event);

  const outboxRelays = relaySet(extraRelays.getValue(), relays);
  const relayGroups: Record<string, string[]> = {
    Outbox: [...outboxRelays],
    ...extraGroups,
  };
  await outboxStore.publish(event, relayGroups);
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
 * Results are persisted to IndexedDB (gitworkshop / nip05-identities) so that
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
// NIP-34 singleton loaders for Issues, Patches, and PRs
//
// Each loader is a SINGLE instance per tag name, so all per-item calls
// within the buffer window are collapsed into one relay subscription.
//
// List level — essentials + comments
//   Essentials (#e tag, bufferTime: 100ms): status (1630-1633), labels (1985),
//   and deletions (5) for every item on the page.
//   Comments (#E tag, bufferTime: 500ms): NIP-22 comments (1111) and PR
//   updates (1619). The longer buffer ensures essentials land first.
//
// Thread level — all child events, no kind restriction (detail pages only)
//   Three loaders for the three tag names used to reference thread members:
//   #e (lowercase), #E (uppercase/NIP-22 root), #q (quote).
//   No kind restriction — fetches reactions, zaps, deletions, and any other
//   events that tag a thread member. Will overlap with essentials/comments
//   data already fetched, but the EventStore deduplicates on receipt.
// ---------------------------------------------------------------------------

const NIP34_ESSENTIALS_BUFFER = 100;
const NIP34_COMMENTS_BUFFER = 500;
const NIP34_THREAD_BUFFER = 500;

/**
 * Essentials loader (#e tag).
 * Fetches status (1630-1633), NIP-32 labels (1985), deletion requests (5),
 * and legacy NIP-34 replies (kind 1 and 1622) for issues/patches/PRs.
 *
 * Uses createPaginatedTagValueLoader which combines the historical fetch,
 * per-relay backward pagination, and a persistent live subscription in one.
 *
 * Legacy replies use NIP-10 #e tagging (not NIP-22 #E), so they must be
 * fetched via this #e loader rather than the #E comments loader. Including
 * them here is a bit of a hack — semantically they're comments, not
 * essentials, and they arrive earlier (100ms buffer vs 500ms for comments).
 * But legacy replies are an edge case in practice, so this is a reasonable
 * tradeoff vs. creating an additional singleton loader and subscription.
 */
export const nip34EssentialsLoader = createPaginatedTagValueLoader(pool, "e", {
  cacheRequest,
  eventStore,
  kinds: [1630, 1631, 1632, 1633, 1985, 5, ...LEGACY_REPLY_KINDS],
  bufferTime: NIP34_ESSENTIALS_BUFFER,
});

/**
 * Comments loader (#E tag).
 * Fetches NIP-22 comments (kind 1111) and PR updates (kind 1619).
 * Uses the uppercase `E` root tag, so it needs its own loader instance
 * separate from the `#e` loaders. The longer buffer ensures essentials
 * land first.
 */
export const nip34CommentsLoader = createPaginatedTagValueLoader(pool, "E", {
  cacheRequest,
  eventStore,
  kinds: [1111, 1619],
  bufferTime: NIP34_COMMENTS_BUFFER,
});

/**
 * Thread loader — replies (#e tag). All events referencing a thread member
 * via lowercase `e` tag. No kind restriction. Only fired on detail pages.
 */
const nip34ThreadReplyLoader = createPaginatedTagValueLoader(pool, "e", {
  cacheRequest,
  eventStore,
  bufferTime: NIP34_THREAD_BUFFER,
});

/**
 * Thread loader — root references (#E tag). All events referencing a thread
 * member via uppercase `E` tag (NIP-22 root reference). No kind restriction.
 * Only fired on detail pages.
 */
const nip34ThreadRootLoader = createPaginatedTagValueLoader(pool, "E", {
  cacheRequest,
  eventStore,
  bufferTime: NIP34_THREAD_BUFFER,
});

/**
 * Thread loader — quotes (#q tag). All events quoting a thread member.
 * No kind restriction. Only fired on detail pages.
 */
const nip34ThreadQuoteLoader = createPaginatedTagValueLoader(pool, "q", {
  cacheRequest,
  eventStore,
  bufferTime: NIP34_THREAD_BUFFER,
});

// ---------------------------------------------------------------------------
// NIP-34 observable factories
//
// Pure RxJS observable factories — no React, no hooks. Consumed by React
// hooks via use$(), which handles subscription lifecycle.
//
// Two levels, each non-additive (no overlap):
//
//   nip34ListLoader    — list level: essentials + comments for a single item.
//                        Also used by nip34RepoLoader to fire both loaders
//                        for each newly discovered item.
//
//   nip34ThreadItemLoader — thread level: ALL events referencing the root
//                        or any comment via #e, #E, or #q tags (no kind
//                        restriction). Recursively fetches child events
//                        for each comment. Only fired on detail pages.
//
//   nip34RepoLoader    — repo level: subscribes to all items for a set of
//                        repo coordinates and pipes each newly discovered
//                        item ID into nip34ListLoader.
//
// Each loader is a createPaginatedTagValueLoader instance that handles the
// historical fetch, per-relay backward pagination, and persistent live
// subscription in one. Calls within the same buffer window are batched into
// a single relay subscription per relay automatically.
// ---------------------------------------------------------------------------

/** All root item kinds tracked at the repo level (issues + PR root kinds). */
const REPO_ITEM_KINDS = [ISSUE_KIND, ...PR_ROOT_KINDS] as const;

/** Kind 7 reaction — used for repo stars. */
const REACTION_KIND = 7;

/** Kind 10018 — NIP-51 Git repositories follow list; used for repo follower counts. */
const GIT_REPOS_FOLLOW_KIND = 10018 as const;

/**
 * List-level loader for a single item.
 *
 * Fires both essentials (status, labels, deletions) and comments loaders for
 * the given item ID against the provided relay list. Each loader handles its
 * own historical fetch (backward pagination until exhausted) and persistent
 * live subscription.
 *
 * The relay list is a static snapshot — callers are responsible for
 * reactivity. nip34RepoLoader re-fires this function when the RelayGroup
 * gains new relays. useNip34ItemLoader re-subscribes via use$() when
 * repoRelayKey changes (driven by useRelayGroupUrls).
 *
 * Because nip34EssentialsLoader and nip34CommentsLoader are singleton
 * instances, calls within the same buffer window are batched into a single
 * REQ per relay automatically.
 *
 * @param itemId - The event ID of the issue / patch / PR
 * @param relays - Relay URLs to query (snapshot at call time)
 */
export function nip34ListLoader(
  itemId: string,
  relays: string[],
): Observable<PaginatedTagValueResponse> {
  return merge(
    nip34EssentialsLoader({ value: itemId, relays }),
    nip34CommentsLoader({ value: itemId, relays }),
  );
}

/**
 * Repo-level observable factory.
 *
 * Subscribes to all NIP-34 root items (issues + PR/patch roots) for the given
 * repository coordinates via the relay group. For each newly discovered item
 * ID, calls nip34ListLoader so essentials and comments are fetched.
 *
 * Deduplication: a seenIds Set in the closure ensures each item ID is
 * submitted to the loaders exactly once, regardless of how many times the
 * relay re-delivers the root event. The set is fresh per subscription —
 * navigating away and back creates a new observable with a new set,
 * triggering a fresh fetch.
 *
 * Because nip34EssentialsLoader and nip34CommentsLoader are singleton
 * instances backed by batchLoader, all per-item calls within each loader's
 * bufferTime window are collapsed into a single relay subscription — so N
 * items produce one essentials REQ and one comments REQ, not 2N REQs.
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
    // Track relay URLs we have already fired loaders against so we can detect
    // genuinely new relays when the group grows.
    const knownRelayUrls = new Set<string>();

    // Fire nip34ListLoader for a single item against a specific set of relays.
    // Inline so it can close over subscriber and seenIds.
    function fireLoaders(id: string, relays: string[]): void {
      nip34ListLoader(id, relays).subscribe(subscriber);
    }

    // Subscribe to RelayGroup relay list changes. relays$ is protected in TS
    // but public at runtime — cast to access it so we can react to new relays
    // being added without polling.
    const relays$ = (relayGroup as unknown as { relays$: Observable<IRelay[]> })
      .relays$;

    const relaySub = relays$
      .pipe(
        // Map to URL strings for stable comparison
        map((relays) => relays.map((r) => r.url)),
        // Only proceed when the URL set actually changes
        distinctUntilChanged(
          (a, b) =>
            a.length === b.length && a.every((url) => knownRelayUrls.has(url)),
        ),
      )
      .subscribe((currentUrls) => {
        // Diff: find relay URLs not yet known
        const newUrls = currentUrls.filter((url) => !knownRelayUrls.has(url));
        for (const url of newUrls) knownRelayUrls.add(url);

        if (newUrls.length === 0) return;

        // For every item already discovered, fire loaders against the new
        // relays only. createPaginatedTagValueLoader batches all these calls
        // within its buffer window into a single REQ per relay.
        for (const id of seenIds) {
          fireLoaders(id, newUrls);
        }
      });

    // Subscribe to issues, patches, and PRs — pipe each new item into the
    // per-item essentials + comments loaders against all current relays.
    const itemSub = relayGroup
      .subscription([{ kinds: [...REPO_ITEM_KINDS], "#a": coords } as Filter], {
        reconnect: Infinity,
        resubscribe: Infinity,
      })
      .pipe(onlyEvents(), mapEventsToStore(eventStore))
      .subscribe({
        next: (event) => {
          const ev = event as NostrEvent;
          if (!seenIds.has(ev.id)) {
            seenIds.add(ev.id);
            // Use all currently known relays — knownRelayUrls is already
            // populated by the relaySub above (relays$ is a BehaviorSubject
            // so relaySub fires synchronously before itemSub can emit).
            fireLoaders(ev.id, [...knownRelayUrls]);
          }
        },
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });

    // Subscribe to self-contained repo-level events: kind 7 reactions (stars)
    // and kind 10018 follow lists. Both are keyed by the announcement `a` tag
    // and need no per-item loading, so they share a single subscription.
    const repoMetaSub = relayGroup
      .subscription(
        [
          {
            kinds: [REACTION_KIND, GIT_REPOS_FOLLOW_KIND],
            "#a": coords,
          } as Filter,
        ],
        {
          reconnect: Infinity,
          resubscribe: Infinity,
        },
      )
      .pipe(onlyEvents(), mapEventsToStore(eventStore))
      .subscribe({
        error: (err) => subscriber.error(err),
      });

    return () => {
      relaySub.unsubscribe();
      itemSub.unsubscribe();
      repoMetaSub.unsubscribe();
    };
  });
}

/**
 * Fire all three thread loaders for a single event ID against a specific
 * relay list (static snapshot at call time).
 */
function nip34ThreadLoadAll(
  itemId: string,
  relays: string[],
): Observable<PaginatedTagValueResponse> {
  return merge(
    nip34ThreadReplyLoader({ value: itemId, relays }),
    nip34ThreadRootLoader({ value: itemId, relays }),
    nip34ThreadQuoteLoader({ value: itemId, relays }),
  );
}

/**
 * Thread-level loader for a single item (detail pages only).
 *
 * Fetches ALL events that reference the root item or any of its comments
 * via #e, #E, or #q tags — no kind restriction. This includes reactions,
 * zaps, deletions, quotes, and any other referencing events.
 *
 * Does NOT re-fire essentials or comments — those are handled separately
 * by nip34ListLoader (already called at the repo/list level). The no-kind
 * thread loaders will return some of the same events (the EventStore
 * deduplicates on receipt).
 *
 * For each comment discovered by nip34CommentsLoader, all three thread
 * loaders are fired recursively so child events on individual comments
 * (reactions, zaps, deletions, etc.) are also fetched. A seenIds set
 * prevents duplicate loader calls within the same subscription lifetime.
 * Because the thread loaders are singleton batching loaders, all per-comment
 * calls within their bufferTime window are collapsed into a single relay
 * subscription per tag name.
 *
 * Reactive relay list: accepts Observable<string[]> | string[]. When the
 * observable emits new relay URLs, loaders are re-fired for all already-seen
 * comment IDs against only the new relays — existing subscriptions are
 * untouched. New comments are always fetched against all current relays.
 *
 * @param itemId - The event ID of the issue / patch / PR
 * @param relays - Relay URLs to query (reactive or static)
 */
export function nip34ThreadItemLoader(
  itemId: string,
  relays: Observable<string[]> | string[],
): Observable<PaginatedTagValueResponse> {
  return new Observable<PaginatedTagValueResponse>((subscriber) => {
    // seenIds: all comment IDs discovered so far (root item + comments)
    const seenIds = new Set<string>();
    // knownRelayUrls: relay URLs we have already fired loaders against
    const knownRelayUrls = new Set<string>();

    // Fire all three thread loaders for an item against a specific relay list
    function fireThreadLoaders(id: string, relayList: string[]): void {
      nip34ThreadLoadAll(id, relayList).subscribe(subscriber);
    }

    // Subscribe to relay list changes. When new relay URLs appear, re-fire
    // loaders for all already-seen IDs against only the new relays.
    const relays$ = Array.isArray(relays)
      ? (new Observable<string[]>((sub) => {
          sub.next(relays);
          sub.complete();
        }) as Observable<string[]>)
      : relays;

    const relaySub = relays$
      .pipe(
        map((urls) => urls),
        distinctUntilChanged(
          (a, b) =>
            a.length === b.length && a.every((url) => knownRelayUrls.has(url)),
        ),
      )
      .subscribe((currentUrls) => {
        const newUrls = currentUrls.filter((url) => !knownRelayUrls.has(url));
        for (const url of newUrls) knownRelayUrls.add(url);
        if (newUrls.length === 0) return;

        // Re-fire for all already-seen IDs (root + comments) on new relays only.
        // createPaginatedTagValueLoader batches these into one REQ per relay.
        for (const id of seenIds) {
          fireThreadLoaders(id, newUrls);
        }
      });

    // Fire thread loaders for the root item — uses all currently known relays
    // (relaySub fires synchronously above since relays$ emits immediately).
    seenIds.add(itemId);
    fireThreadLoaders(itemId, [...knownRelayUrls]);

    // Recursively fetch child events for each comment.
    // New comments use all currently known relays at discovery time.
    const commentsSub = nip34CommentsLoader({
      value: itemId,
      relays: [...knownRelayUrls],
    }).subscribe({
      next: (msg) => {
        if (msg === "EOSE") return;
        const event = msg as NostrEvent;
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          fireThreadLoaders(event.id, [...knownRelayUrls]);
        }
      },
      error: (err) => subscriber.error(err),
    });

    return () => {
      relaySub.unsubscribe();
      commentsSub.unsubscribe();
    };
  });
}
