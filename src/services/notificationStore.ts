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

import { BehaviorSubject, combineLatest, firstValueFrom, of } from "rxjs";
import { timeout, map, switchMap, distinctUntilChanged } from "rxjs/operators";
import { mapEventsToStore } from "applesauce-core";
import { MailboxesModel } from "applesauce-core/models";
import { onlyEvents } from "applesauce-relay";
import { pool, eventStore, addressLoader } from "@/services/nostr";
import { extraRelays, lookupRelays, gitIndexRelays } from "@/services/settings";
import {
  buildNotificationFilters,
  buildNotificationBadgeFilters,
  buildRepoStarFilter,
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
} from "./notificationSync";

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
// Relay resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the relay list for notification subscriptions.
 * Uses the user's NIP-65 inbox relays plus the configured extra relays.
 * Falls back to extra relays alone if MailboxesModel hasn't loaded yet.
 */
async function resolveNotificationRelays(pubkey: string): Promise<string[]> {
  try {
    const mailboxes = await firstValueFrom(
      eventStore
        .model(MailboxesModel, pubkey)
        .pipe(timeout({ first: 1000, with: () => of(undefined) })),
    );
    const inboxes = mailboxes?.inboxes ?? [];
    return [...new Set([...inboxes, ...extraRelays.getValue()])];
  } catch {
    return [...new Set([...extraRelays.getValue()])];
  }
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
  // Keeps a WebSocket open for new arrivals; seeds enough events for the dot.
  // ---------------------------------------------------------------------------
  const inboxRelays$ = new BehaviorSubject<string[]>([]);
  const badgeFilters = buildNotificationBadgeFilters(pubkey);
  let badgeSub = { unsubscribe: () => {} };

  resolveNotificationRelays(pubkey).then((relays) => {
    inboxRelays$.next(relays);
    badgeSub = pool
      .subscription(relays, badgeFilters, {
        reconnect: Infinity,
        resubscribe: Infinity,
      })
      .pipe(onlyEvents(), mapEventsToStore(eventStore))
      .subscribe();
  });

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
  // Fetch the nsec envelope from lookup relays + user outbox relays
  // ---------------------------------------------------------------------------

  const nsecEnvelopeSub = addressLoader({
    kind: NIP78_KIND,
    pubkey,
    identifier: NOTIFICATION_NSEC_D_TAG,
  }).subscribe();

  let nsecOutboxSub = { unsubscribe: () => {} };
  firstValueFrom(
    eventStore
      .model(MailboxesModel, pubkey)
      .pipe(timeout({ first: 1000, with: () => of(undefined) })),
  )
    .then((mailboxes) => {
      const outboxes = mailboxes?.outboxes ?? [];
      const relays = [...new Set([...outboxes, ...lookupRelays.getValue()])];
      if (relays.length === 0) return;

      const nsecFilter = {
        kinds: [NIP78_KIND],
        authors: [pubkey],
        "#d": [NOTIFICATION_NSEC_D_TAG],
      } as Filter;

      nsecOutboxSub = pool
        .subscription(relays, [nsecFilter])
        .pipe(onlyEvents(), mapEventsToStore(eventStore))
        .subscribe();
    })
    .catch(() => {});

  // ---------------------------------------------------------------------------
  // Once the nsec envelope is decrypted, fetch the state event
  // ---------------------------------------------------------------------------

  let stateEventSub = { unsubscribe: () => {} };

  getOrCreateNotificationSigner(pubkey)
    .then(async (notifSigner) => {
      if (!notifSigner) return;
      const notifPubkey = await notifSigner.getPublicKey();

      const stateSub = addressLoader({
        kind: NIP78_KIND,
        pubkey: notifPubkey,
        identifier: NOTIFICATION_STATE_D_TAG,
      }).subscribe();

      firstValueFrom(
        eventStore
          .model(MailboxesModel, pubkey)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      )
        .then((mailboxes) => {
          const outboxes = mailboxes?.outboxes ?? [];
          if (outboxes.length === 0) return;

          const stateFilter = {
            kinds: [NIP78_KIND],
            authors: [notifPubkey],
            "#d": [NOTIFICATION_STATE_D_TAG],
          } as Filter;

          const outboxStateSub = pool
            .subscription(outboxes, [stateFilter])
            .pipe(onlyEvents(), mapEventsToStore(eventStore))
            .subscribe();

          const prevUnsub = stateEventSub.unsubscribe.bind(stateEventSub);
          stateEventSub = {
            unsubscribe: () => {
              prevUnsub();
              stateSub.unsubscribe();
              outboxStateSub.unsubscribe();
            },
          };
        })
        .catch(() => {
          stateEventSub = stateSub;
        });
    })
    .catch(() => {});

  const nip78WatchSub = watchNip78Event(pubkey, readState$);

  // ---------------------------------------------------------------------------
  // Repo discovery — own repos for relay coverage and star notifications
  // ---------------------------------------------------------------------------

  const repoCoords$ = new BehaviorSubject<string[]>([]);

  const ownRepoFilter: Filter = { kinds: [REPO_KIND], authors: [pubkey] };
  const ownRepoSub = gitIndexRelays
    .pipe(
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
      ),
      switchMap((relays) =>
        pool
          .subscription(relays, [ownRepoFilter], {
            reconnect: Infinity,
            resubscribe: Infinity,
          })
          .pipe(onlyEvents(), mapEventsToStore(eventStore)),
      ),
    )
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
      const urlSet = new Set<string>(indexRelays);
      for (const ev of events) {
        for (const tag of ev.tags) {
          if (tag[0] === "relays") {
            for (let i = 1; i < tag.length; i++) {
              if (tag[i]) urlSet.add(tag[i]);
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
  const repoActivitySub = combineLatest([
    repoCoords$,
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
        const inboxSet = new Set(inboxRelays);
        const extraRepoRelays = repoRelays.filter((r) => !inboxSet.has(r));

        const subs = [
          pool
            .subscription(repoRelays, [starFilter], {
              reconnect: Infinity,
              resubscribe: Infinity,
            })
            .pipe(onlyEvents(), mapEventsToStore(eventStore)),
        ];

        if (extraRepoRelays.length > 0) {
          // Badge filters on extra repo relays so we don't miss thread activity
          // on repos whose relays aren't in the user's inbox
          subs.push(
            pool
              .subscription(extraRepoRelays, badgeFilters, {
                reconnect: Infinity,
                resubscribe: Infinity,
              })
              .pipe(onlyEvents(), mapEventsToStore(eventStore)),
          );
        }

        return combineLatest(subs);
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
      nsecOutboxSub.unsubscribe();
      stateEventSub.unsubscribe();
      nip78WatchSub.unsubscribe();
      ownRepoSub.unsubscribe();
      repoCoordsStoreSub.unsubscribe();
      repoActivitySub.unsubscribe();
      entry.historyLoader?.destroy();
      repoCoords$.complete();
      inboxRelays$.complete();
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
    historyLoaderPromise = resolveNotificationRelays(pubkey).then((relays) => {
      const fullFilters = buildNotificationFilters(pubkey);
      const loader = createManualTimelineLoader(pool, relays, fullFilters, {
        eventStore,
      });
      entry.historyLoader = loader;
      // Fire the first full page immediately
      loader.loadMore(NOTIFICATION_PAGE_LIMIT);
      return loader;
    });
    return historyLoaderPromise;
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
