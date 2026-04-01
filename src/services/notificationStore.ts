/**
 * NotificationStore — per-pubkey singleton that manages:
 *   - BehaviorSubject<NotificationReadState> (local + NIP-78 merged)
 *   - localStorage persistence
 *   - Relay subscriptions for notification events (inbox relays + extra)
 *   - Reference counting (acquire/release)
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

import { BehaviorSubject, firstValueFrom, of } from "rxjs";
import { timeout, map, switchMap, distinctUntilChanged } from "rxjs/operators";
import { mapEventsToStore } from "applesauce-core";
import { MailboxesModel } from "applesauce-core/models";
import { onlyEvents } from "applesauce-relay";
import { pool, eventStore, addressLoader } from "@/services/nostr";
import { extraRelays, lookupRelays, gitIndexRelays } from "@/services/settings";
import {
  buildNotificationFilters,
  buildRepoStarFilter,
  parseReadState,
  DEFAULT_READ_STATE,
  NIP78_KIND,
  NOTIFICATION_STATE_D_TAG,
  NOTIFICATION_NSEC_D_TAG,
  type NotificationReadState,
} from "@/lib/notifications";
import { REPO_KIND } from "@/lib/nip34";
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

export interface NotificationStoreEntry {
  pubkey: string;
  readState$: BehaviorSubject<NotificationReadState>;
  /**
   * Reactive list of the user's own repo coordinates ("30617:<pubkey>:<dtag>").
   * Updated whenever the EventStore sees new kind:30617 events authored by this
   * user. Used by NotificationModel to group social notifications by repo.
   */
  repoCoords$: BehaviorSubject<string[]>;
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

  // Subscribe to notification events from inbox relays + extra relays
  const filters = buildNotificationFilters(pubkey);
  let relaySub = { unsubscribe: () => {} };
  resolveNotificationRelays(pubkey).then((relays) => {
    relaySub = pool
      .subscription(relays, filters, {
        reconnect: Infinity,
        resubscribe: Infinity,
      })
      .pipe(onlyEvents(), mapEventsToStore(eventStore))
      .subscribe();
  });

  // ---------------------------------------------------------------------------
  // Fetch the nsec envelope from lookup relays + user outbox relays
  // ---------------------------------------------------------------------------

  // One-shot address loader for the nsec envelope (lookup relays)
  const nsecEnvelopeSub = addressLoader({
    kind: NIP78_KIND,
    pubkey,
    identifier: NOTIFICATION_NSEC_D_TAG,
  }).subscribe();

  // Also query outbox relays for the nsec envelope
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
  // Once the nsec envelope is decrypted, fetch the state event authored by
  // the notification keypair from the same relay sets.
  // ---------------------------------------------------------------------------

  let stateEventSub = { unsubscribe: () => {} };

  getOrCreateNotificationSigner(pubkey)
    .then(async (notifSigner) => {
      if (!notifSigner) return;
      const notifPubkey = await notifSigner.getPublicKey();

      // Fetch state event from lookup relays
      const stateSub = addressLoader({
        kind: NIP78_KIND,
        pubkey: notifPubkey,
        identifier: NOTIFICATION_STATE_D_TAG,
      }).subscribe();

      // Also query user outbox relays for the state event.
      // Lookup relays (NIP-65 indexers) are not included here because the
      // state event is authored by the notification keypair, not the user —
      // indexers won't store events from an unknown pubkey.
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

          // Combine both into stateEventSub for cleanup
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

  // Watch for the nsec envelope + state event in the store, decrypt, and merge
  const nip78WatchSub = watchNip78Event(pubkey, readState$);

  // ---------------------------------------------------------------------------
  // Repo discovery — own repos for relay coverage and star notifications
  // ---------------------------------------------------------------------------

  // Reactive list of the user's own repo coordinates, derived from the store.
  // Starts empty; populated once kind:30617 events arrive from the relay.
  // Used for two purposes:
  //   1. Subscribing to repo-star (kind:7) events on git index relays
  //   2. Subscribing to thread notifications on each repo's own relays,
  //      so we don't miss activity on repos whose relays aren't in our inbox
  const repoCoords$ = new BehaviorSubject<string[]>([]);

  // Fetch the user's own repo announcements from git index relays.
  const ownRepoFilter: Filter = { kinds: [REPO_KIND], authors: [pubkey] };
  const ownRepoSub = pool
    .subscription(gitIndexRelays.getValue(), [ownRepoFilter], {
      reconnect: Infinity,
      resubscribe: Infinity,
    })
    .pipe(onlyEvents(), mapEventsToStore(eventStore))
    .subscribe();

  // Keep repoCoords$ in sync with the EventStore — update whenever new
  // kind:30617 events authored by this user arrive.
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
          .filter((c): c is string => !!c),
      ),
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
      ),
    )
    .subscribe((coords) => repoCoords$.next(coords));

  // Reactive subscription for repo stars (kind:7).
  // Stars are published to git index relays (where repo announcements live).
  const repoStarSub = repoCoords$
    .pipe(
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
      ),
      switchMap((coords) => {
        if (coords.length === 0) return of(undefined);
        return pool
          .subscription(
            gitIndexRelays.getValue(),
            [buildRepoStarFilter(coords)],
            {
              reconnect: Infinity,
              resubscribe: Infinity,
            },
          )
          .pipe(onlyEvents(), mapEventsToStore(eventStore));
      }),
    )
    .subscribe();

  // Reactive subscription for thread notifications on repo relays.
  // Issues, patches, and comments are published to the repo's own relays
  // (declared in the repo announcement), which may differ from the user's
  // NIP-65 inbox relays. Subscribing here ensures we don't miss activity
  // on repos whose relays aren't already in our inbox.
  const threadFilters = buildNotificationFilters(pubkey);
  const repoThreadSub = repoCoords$
    .pipe(
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
      ),
      switchMap((coords) => {
        if (coords.length === 0) return of(undefined);
        // Fetch each repo announcement to get its declared relays, then
        // subscribe to thread notifications on those relays.
        // For now we use git index relays as a reasonable proxy — the index
        // relay stores repo announcements and is likely to also store activity.
        return pool
          .subscription(gitIndexRelays.getValue(), threadFilters, {
            reconnect: Infinity,
            resubscribe: Infinity,
          })
          .pipe(onlyEvents(), mapEventsToStore(eventStore));
      }),
    )
    .subscribe();

  const entry: NotificationStoreEntry = {
    pubkey,
    readState$,
    repoCoords$,
    publishTimer: null,
    cleanup: () => {
      localSub.unsubscribe();
      relaySub.unsubscribe();
      nsecEnvelopeSub.unsubscribe();
      nsecOutboxSub.unsubscribe();
      stateEventSub.unsubscribe();
      nip78WatchSub.unsubscribe();
      ownRepoSub.unsubscribe();
      repoCoordsStoreSub.unsubscribe();
      repoStarSub.unsubscribe();
      repoThreadSub.unsubscribe();
      repoCoords$.complete();
    },
    refCount: 1,
  };

  storeMap.set(pubkey, entry);
  return entry;
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
