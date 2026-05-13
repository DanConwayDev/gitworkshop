/**
 * NotificationStore — per-pubkey singleton that manages:
 *   - BehaviorSubject<NotificationReadState> (local + NIP-78 merged)
 *   - localStorage persistence
 *   - Relay subscriptions for notification events (inbox relays + extra)
 *   - Reference counting (acquire/release)
 *
 * ## Fetch strategy
 *
 * Thread notifications use a two-phase approach:
 *
 *   Phase 1 — Badge (fires immediately on login):
 *     A live pool.subscription with limit:10 badge filters. Keeps a WebSocket
 *     open for new arrivals and seeds the EventStore with enough events to
 *     show a dot indicator. Cheap and always-on.
 *
 *   Phase 2 — History (fires on first /notifications visit):
 *     A ManualTimelineLoader that pages backwards through history.
 *     - First call: loadMore(10) from the badge, then loadMore(200) from the page
 *     - Each call fetches one block; per-relay cursors are tracked internally
 *     - historyLoading$ / historyHasMore$ drive the spinner and "load more" button
 *     - activateFullFetch() triggers the first 200-event page; subsequent visits
 *       are no-ops (the loader already exists and has its cursor state)
 *
 * ## Two-event NIP-78 architecture
 *
 * The notification state is stored in two NIP-78 events:
 *
 *   1. Nsec envelope (d: "git-notifications-nsec") — authored by the user,
 *      encrypted with their signer. Contains a dedicated hex private key.
 *      Fetched from lookup relays + user outbox relays.
 *
 *   2. State event (d: "git-notifications-state") — authored and encrypted
 *      by the dedicated notification keypair. Fetched once the notification
 *      pubkey is known (after the nsec envelope is decrypted).
 *
 * NIP-78 publish and decrypt/merge logic lives in notificationSync.ts.
 * Action implementations (markAsRead, etc.) live in notificationActions.ts.
 */

import { BehaviorSubject, combineLatest, merge, of } from "rxjs";
import {
  map,
  switchMap,
  distinctUntilChanged,
  debounceTime,
  startWith,
} from "rxjs/operators";
import { mapEventsToStore } from "applesauce-core";
import { MailboxesModel } from "applesauce-core/models";
import { onlyEvents } from "applesauce-relay";
import { pool, eventStore, addressLoader } from "@/services/nostr";
import {
  fallbackRelays,
  lookupRelays,
  gitIndexRelays,
} from "@/services/settings";
import { resilientSubscription } from "@/lib/resilientSubscription";
import {
  buildNotificationFilters,
  buildNotificationBadgeFilters,
  buildRepoStarFilter,
  buildRepoZapFilter,
  parseReadState,
  DEFAULT_READ_STATE,
  NIP78_KIND,
  NOTIFICATION_STATE_D_TAG,
  NOTIFICATION_NSEC_D_TAG,
  type NotificationReadState,
} from "@/lib/notifications";
import { REPO_KIND } from "@/lib/nip34";
import {
  createManualTimelineLoader,
  type ManualTimelineLoader,
} from "@/lib/manualTimelineLoader";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import {
  schedulePublish,
  watchNip78Event,
  getOrCreateNotificationSigner,
  evictNotificationSigner,
  getCachedNotificationPubkey,
} from "./notificationSync";
import { normalizeUrl } from "@/lib/url";

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function localStorageKey(pubkey: string): string {
  return `notifications_state:${pubkey}`;
}

function loadFromLocalStorage(pubkey: string): NotificationReadState {
  try {
    const raw = localStorage.getItem(localStorageKey(pubkey));
    if (raw) return parseReadState(JSON.parse(raw));
  } catch {
    // ignore
  }
  return { ...DEFAULT_READ_STATE };
}

function saveToLocalStorage(
  pubkey: string,
  state: NotificationReadState,
): void {
  try {
    localStorage.setItem(localStorageKey(pubkey), JSON.stringify(state));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Entry type
// ---------------------------------------------------------------------------

/** Number of events per page on the notifications page */
export const NOTIFICATION_PAGE_LIMIT = 200;

export interface NotificationStoreEntry {
  pubkey: string;
  readState$: BehaviorSubject<NotificationReadState>;
  /**
   * Reactive list of the user's own repo coordinates ("30617:<pubkey>:<dtag>").
   * Updated whenever the EventStore sees new kind:30617 events authored by this
   * user. Used by NotificationModel to group social notifications by repo.
   */
  repoCoords$: BehaviorSubject<string[]>;
  /** Manual timeline loader for paged history fetches */
  historyLoader: ManualTimelineLoader | null;
  /** Debounce timer handle — owned here so notificationSync can clear it */
  publishTimer: ReturnType<typeof setTimeout> | null;
  /** Subscription teardown */
  cleanup: (() => void) | null;
  /** Reference count — cleaned up when it drops to 0 */
  refCount: number;
}

// ---------------------------------------------------------------------------
// updateReadState — exported so notificationActions.ts can use it
// ---------------------------------------------------------------------------

export function updateReadState(
  entry: NotificationStoreEntry,
  updater: (prev: NotificationReadState) => NotificationReadState,
): void {
  const next = updater(entry.readState$.getValue());
  entry.readState$.next(next);
  // Delegate debounce + publish to notificationSync
  schedulePublish(entry.pubkey, entry.readState$, entry);
}

// ---------------------------------------------------------------------------
// Relay resolution — reactive observables
// ---------------------------------------------------------------------------

/**
 * Observable of the user's NIP-65 inbox relays merged with fallbackRelays.
 * Emits immediately with fallbackRelays alone (startWith), then re-emits
 * whenever MailboxesModel updates. This ensures subscriptions start right
 * away and automatically expand to the user's real inbox relays once the
 * kind:10002 event arrives from the relay.
 */
function inboxRelaysObservable(pubkey: string) {
  return combineLatest([
    eventStore.model(MailboxesModel, pubkey).pipe(startWith(undefined)),
    fallbackRelays,
  ]).pipe(
    map(([mailboxes, extra]) => {
      const inboxes = mailboxes?.inboxes ?? [];
      return [...new Set([...inboxes, ...extra].map(normalizeUrl))];
    }),
    distinctUntilChanged(
      (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
    ),
  );
}

/**
 * Observable of the user's NIP-65 outbox relays merged with lookupRelays.
 * Same startWith pattern — emits lookupRelays immediately, then expands.
 */
function outboxRelaysObservable(pubkey: string) {
  return combineLatest([
    eventStore.model(MailboxesModel, pubkey).pipe(startWith(undefined)),
    lookupRelays,
  ]).pipe(
    map(([mailboxes, lookup]) => {
      const outboxes = mailboxes?.outboxes ?? [];
      return [...new Set([...outboxes, ...lookup].map(normalizeUrl))];
    }),
    distinctUntilChanged(
      (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
    ),
  );
}

// ---------------------------------------------------------------------------
// Singleton store map
// ---------------------------------------------------------------------------

const storeMap = new Map<string, NotificationStoreEntry>();

export function acquireNotificationStore(
  pubkey: string,
): NotificationStoreEntry {
  const existing = storeMap.get(pubkey);
  if (existing) {
    existing.refCount++;
    return existing;
  }

  const localState = loadFromLocalStorage(pubkey);
  const readState$ = new BehaviorSubject<NotificationReadState>(localState);

  // Persist to localStorage on every change
  const localSub = readState$.subscribe((state) => {
    saveToLocalStorage(pubkey, state);
  });

  // ---------------------------------------------------------------------------
  // Phase 1 — Badge: live subscription with limit:10 badge filters.
  // Reactive to MailboxesModel — re-subscribes when inbox relays change.
  // Starts immediately with fallbackRelays, expands once kind:10002 arrives.
  // ---------------------------------------------------------------------------
  const badgeFilters = buildNotificationBadgeFilters(pubkey);

  // inboxRelays$ is a reactive observable (not a BehaviorSubject) so that
  // repoActivitySub (which combines it) also reacts to relay list changes.
  const inboxRelays$ = inboxRelaysObservable(pubkey);

  const badgeSub = resilientSubscription(pool, inboxRelays$, badgeFilters, {
    retryCount: Infinity,
  })
    .pipe(onlyEvents(), mapEventsToStore(eventStore))
    .subscribe();

  // ---------------------------------------------------------------------------
  // Phase 2 — History loader: created lazily on first activateFullFetch() call.
  // Stored on the entry so activateFullFetch() is idempotent.
  // ---------------------------------------------------------------------------
  // historyLoader is null until activateFullFetch() is called.
  // It is created with the full thread filters (no limit — limit is set per
  // loadMore() call) and the resolved inbox relays.
  // We store a promise so concurrent activateFullFetch() calls don't race.
  let historyLoaderPromise: Promise<ManualTimelineLoader> | null = null;

  // ---------------------------------------------------------------------------
  // Fetch the nsec envelope and state event from lookup relays + outbox relays.
  //
  // Fast path (99.9% of sessions): the notification pubkey is already in
  // localStorage from a previous session. We can issue a single
  // resilientSubscription with both filters immediately — one relay round-trip
  // instead of two.
  //
  // Slow path (first-ever login, or cache cleared): notifPubkey is unknown
  // until the nsec envelope arrives and is decrypted. We start with just the
  // nsec filter and upgrade to a combined subscription once the envelope lands.
  // ---------------------------------------------------------------------------

  const nsecEnvelopeSub = addressLoader({
    kind: NIP78_KIND,
    pubkey,
    identifier: NOTIFICATION_NSEC_D_TAG,
  }).subscribe();

  // ---------------------------------------------------------------------------
  // notifPubkey$ — reactive notification pubkey.
  //
  // Starts with the localStorage-cached value (null on first-ever login).
  // Updated by:
  //   - watchNip78Event (below) when the nsec envelope changes in the EventStore
  //   - The slow-path resolver (below) once the envelope is first decrypted
  //
  // Drives the outbox relay subscription: whenever this emits a new value,
  // switchMap tears down the old resilientSubscription and opens a new one
  // with an updated authors filter that includes the new notification pubkey.
  // This ensures the new state event is fetched from relays immediately when
  // another device rotates the nsec.
  // ---------------------------------------------------------------------------
  const cachedNotifPubkey = getCachedNotificationPubkey(pubkey);
  const notifPubkey$ = new BehaviorSubject<string | null>(cachedNotifPubkey);

  if (cachedNotifPubkey) {
    addressLoader({
      kind: NIP78_KIND,
      pubkey: cachedNotifPubkey,
      identifier: NOTIFICATION_STATE_D_TAG,
    }).subscribe();
  }

  // Outbox relay subscription — reactive to both relay list changes and
  // notification pubkey changes. switchMap on notifPubkey$ tears down and
  // rebuilds the resilientSubscription whenever the notification pubkey
  // changes (e.g. another device rotated the nsec). The inner
  // resilientSubscription is itself reactive to relay list changes via
  // outboxRelaysObservable, so relay additions/removals are handled without
  // tearing down the whole subscription.
  const nip78OutboxSub = notifPubkey$
    .pipe(
      switchMap((notifPubkey) => {
        const nip78Filter = {
          kinds: [NIP78_KIND],
          authors: notifPubkey ? [pubkey, notifPubkey] : [pubkey],
          "#d": [NOTIFICATION_NSEC_D_TAG, NOTIFICATION_STATE_D_TAG],
        } as Filter;

        return resilientSubscription(
          pool,
          outboxRelaysObservable(pubkey),
          [nip78Filter],
          { retryCount: Infinity },
        ).pipe(onlyEvents(), mapEventsToStore(eventStore));
      }),
    )
    .subscribe();

  // Slow path: notif pubkey was not cached — wait for the nsec envelope to
  // arrive and be decrypted, then update notifPubkey$ so the outbox sub above
  // rebuilds its filter to include the state event author.
  // We guard on the envelope being present so getOrCreateNotificationSigner
  // doesn't generate a brand-new nsec (and prompt the user's signer) before
  // the relay fetch completes.
  const nsecFilter = {
    kinds: [NIP78_KIND],
    authors: [pubkey],
    "#d": [NOTIFICATION_NSEC_D_TAG],
  } as Filter;

  const stateEventSub = cachedNotifPubkey
    ? null
    : (eventStore.timeline([nsecFilter]) as unknown as Observable<NostrEvent[]>)
        .pipe(
          startWith([] as NostrEvent[]),
          switchMap(async (envelopes) => {
            if (envelopes.length === 0) return null;

            const notifSigner = await getOrCreateNotificationSigner(pubkey);
            if (!notifSigner) return null;
            return await notifSigner.getPublicKey();
          }),
        )
        .subscribe((notifPubkey) => {
          if (!notifPubkey) return;

          // Update notifPubkey$ — this triggers the outbox sub to rebuild
          // its filter and fetch the state event from relays.
          if (notifPubkey !== notifPubkey$.getValue()) {
            notifPubkey$.next(notifPubkey);
          }

          addressLoader({
            kind: NIP78_KIND,
            pubkey: notifPubkey,
            identifier: NOTIFICATION_STATE_D_TAG,
          }).subscribe();
        });

  const nip78WatchSub = watchNip78Event(pubkey, readState$, notifPubkey$);

  // ---------------------------------------------------------------------------
  // Repo discovery — own repos for relay coverage and star notifications
  // ---------------------------------------------------------------------------

  const repoCoords$ = new BehaviorSubject<string[]>([]);

  const ownRepoFilter: Filter = { kinds: [REPO_KIND], authors: [pubkey] };
  const ownRepoSub = resilientSubscription(
    pool,
    gitIndexRelays,
    [ownRepoFilter],
    { retryCount: Infinity },
  )
    .pipe(onlyEvents(), mapEventsToStore(eventStore))
    .subscribe();

  const repoCoordsStoreSub = (
    eventStore.timeline([ownRepoFilter]) as unknown as Observable<NostrEvent[]>
  )
    .pipe(
      map((events) =>
        events
          .map((ev) => {
            const d = ev.tags.find(([t]) => t === "d")?.[1];
            return d ? `${REPO_KIND}:${ev.pubkey}:${d}` : undefined;
          })
          .filter((c): c is string => !!c)
          .sort(),
      ),
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
      ),
    )
    .subscribe((coords) => repoCoords$.next(coords));

  const repoRelays$ = combineLatest([
    gitIndexRelays,
    eventStore.timeline([ownRepoFilter]) as unknown as Observable<NostrEvent[]>,
  ]).pipe(
    map(([indexRelays, events]) => {
      const urlSet = new Set<string>(indexRelays.map(normalizeUrl));
      for (const ev of events) {
        for (const tag of ev.tags) {
          if (tag[0] === "relays") {
            for (let i = 1; i < tag.length; i++) {
              if (tag[i]) urlSet.add(normalizeUrl(tag[i]));
            }
          }
        }
      }
      return [...urlSet].sort();
    }),
    distinctUntilChanged(
      (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
    ),
  );

  // Repo stars live subscription — always-on, no history paging needed here.
  // Stars are not included in the thread loader; they have their own filter.
  //
  // repoCoords$ can emit rapidly on login as own-repo announcements arrive one
  // by one from the git index relay. Without debouncing, switchMap would tear
  // down and recreate the resilientSubscription for each new coord, producing
  // 10+ near-simultaneous REQs for kind:7. debounceTime(500) lets the coord
  // list stabilise before opening a single subscription covering all coords.
  const repoActivitySub = combineLatest([
    repoCoords$.pipe(debounceTime(500)),
    repoRelays$,
    inboxRelays$,
  ])
    .pipe(
      distinctUntilChanged(
        ([coordsA, repoA, inboxA], [coordsB, repoB, inboxB]) =>
          coordsA.length === coordsB.length &&
          coordsA.every((v, i) => v === coordsB[i]) &&
          repoA.length === repoB.length &&
          repoA.every((v, i) => v === repoB[i]) &&
          inboxA.length === inboxB.length &&
          inboxA.every((v, i) => v === inboxB[i]),
      ),
      switchMap(([coords, repoRelays, inboxRelays]) => {
        if (coords.length === 0 || repoRelays.length === 0) {
          return of(undefined);
        }

        // Stars: live subscription on all repo relays, no history limit needed
        // (stars are low-volume). Thread filters go only to repo relays not
        // already covered by the badge subscription to avoid duplicate REQs.
        const starFilter = buildRepoStarFilter(coords);
        const zapFilter = buildRepoZapFilter(coords);
        const inboxSet = new Set(inboxRelays);
        const extraRepoRelays = repoRelays.filter((r) => !inboxSet.has(r));

        const streams = [
          resilientSubscription(pool, repoRelays, [starFilter, zapFilter], {
            retryCount: Infinity,
          }).pipe(onlyEvents(), mapEventsToStore(eventStore)),
        ];

        if (extraRepoRelays.length > 0) {
          // Badge filters on extra repo relays so we don't miss thread activity
          // on repos whose relays aren't in the user's inbox
          streams.push(
            resilientSubscription(pool, extraRepoRelays, badgeFilters, {
              retryCount: Infinity,
            }).pipe(onlyEvents(), mapEventsToStore(eventStore)),
          );
        }

        return merge(...streams);
      }),
    )
    .subscribe();

  const entry: NotificationStoreEntry = {
    pubkey,
    readState$,
    repoCoords$,
    historyLoader: null,
    publishTimer: null,
    cleanup: () => {
      localSub.unsubscribe();
      badgeSub.unsubscribe();
      nsecEnvelopeSub.unsubscribe();
      nip78OutboxSub.unsubscribe();
      stateEventSub?.unsubscribe();
      nip78WatchSub.unsubscribe();
      ownRepoSub.unsubscribe();
      repoCoordsStoreSub.unsubscribe();
      repoActivitySub.unsubscribe();
      entry.historyLoader?.destroy();
      notifPubkey$.complete();
      repoCoords$.complete();
    },
    refCount: 1,
  };

  // Attach the lazy loader factory to the entry via closure
  (
    entry as NotificationStoreEntry & {
      _activateFullFetch: () => Promise<ManualTimelineLoader>;
    }
  )._activateFullFetch = async () => {
    if (historyLoaderPromise) return historyLoaderPromise;
    // Build a reactive relay observable that combines inbox relays and repo
    // relays. The loader subscribes to this and additively opens a new
    // per-relay pipeline whenever a new relay URL appears — existing relay
    // pipelines (and their cursor state) are never torn down.
    //
    // This means:
    //   - Inbox relays are available immediately (startWith in inboxRelaysObservable)
    //   - Repo-declared relays are added as own-repo announcements arrive from
    //     gitIndexRelays, so events on those relays are fetched even if the
    //     announcements hadn't loaded yet when the user opened /notifications.
    const combinedRelays$ = combineLatest([
      inboxRelaysObservable(pubkey),
      repoRelays$,
    ]).pipe(
      map(([inbox, repo]) => [...new Set([...inbox, ...repo])]),
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
      ),
    );

    const fullFilters = buildNotificationFilters(pubkey);
    const loader = createManualTimelineLoader(
      pool,
      combinedRelays$,
      fullFilters,
      {
        eventStore,
        getArchiveCutoff: () => readState$.getValue().ab,
      },
    );
    entry.historyLoader = loader;
    // Fire the first full page immediately
    loader.loadMore(NOTIFICATION_PAGE_LIMIT);
    historyLoaderPromise = Promise.resolve(loader);
    return loader;
  };

  storeMap.set(pubkey, entry);
  return entry;
}

/**
 * Activate the full history fetch for the notifications page.
 * Idempotent — safe to call on every /notifications mount.
 * Returns the ManualTimelineLoader so callers can subscribe to its state.
 */
export async function activateFullFetch(
  pubkey: string,
): Promise<ManualTimelineLoader | null> {
  const entry = storeMap.get(pubkey);
  if (!entry) return null;
  const entryWithLoader = entry as NotificationStoreEntry & {
    _activateFullFetch?: () => Promise<ManualTimelineLoader>;
  };
  return entryWithLoader._activateFullFetch?.() ?? null;
}

export function releaseNotificationStore(pubkey: string): void {
  const entry = storeMap.get(pubkey);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    entry.cleanup?.();
    if (entry.publishTimer) clearTimeout(entry.publishTimer);
    evictNotificationSigner(pubkey);
    storeMap.delete(pubkey);
  }
}
