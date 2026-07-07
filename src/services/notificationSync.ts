/**
 * NIP-78 read-state sync for notifications — two-event architecture.
 *
 * ## How it works
 *
 * ### Nsec envelope (kind 30078, d: "git-notifications-nsec")
 *   - Authored by the user's pubkey, encrypted with their own signer (NIP-44).
 *   - Contains `{ nsec: "<hex private key>" }` — a dedicated notification keypair.
 *   - Created once the first time the user marks a notification.
 *   - Decrypted once per session; the plaintext hex key is cached in localStorage
 *     (alongside the envelope's event ID and created_at) so the user's signer is
 *     never asked again unless a newer envelope arrives from another device.
 *   - If a newer envelope is received (higher created_at), the cache is
 *     invalidated, the new key is decrypted, and the in-memory signer is replaced.
 *
 * ### State event (kind 30078, d: "git-notifications-state")
 *   - Authored and encrypted by the dedicated PrivateKeySigner derived from
 *     the nsec above — no user signer involvement for state updates.
 *   - Published on every debounced state change.
 *   - Decrypted using the same PrivateKeySigner (self-encrypt: pubkey == author).
 *
 * ## Responsibilities
 *   - `getOrCreateNotificationSigner` — resolve (or generate + publish) the
 *     dedicated signer for a given user pubkey.
 *   - `publishReadState` — debounced encrypt-and-publish of the current
 *     NotificationReadState using the dedicated signer.
 *   - `watchNip78Event` — watches the nsec envelope in the EventStore for
 *     updates, keeps the signer current, and reactively decrypts + merges
 *     the state event whenever either event changes.
 *
 * Both publishReadState and watchNip78Event are called from
 * acquireNotificationStore in notificationStore.ts.
 */

import { BehaviorSubject } from "rxjs";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { PrivateKeySigner } from "applesauce-signers/signers";
import { AppDataFactory } from "applesauce-common/factories";
import { eventStore } from "@/services/nostr";
import {
  parseReadState,
  mergeReadStates,
  NIP78_KIND,
  NOTIFICATION_STATE_D_TAG,
  NOTIFICATION_NSEC_D_TAG,
  type NotificationReadState,
} from "@/lib/notifications";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import {
  unlockAppData,
  isAppDataUnlocked,
  getAppDataContent,
} from "applesauce-common/helpers/app-data";
import type { Subscription } from "rxjs";

// ---------------------------------------------------------------------------
// localStorage cache — stores the decrypted nsec alongside envelope metadata
// so we can detect when a newer envelope has arrived from another device.
// ---------------------------------------------------------------------------

interface NsecCache {
  /** Hex-encoded private key */
  hexKey: string;
  /** Event ID of the envelope we decrypted this from */
  eventId: string;
  /** created_at of that envelope — used to detect newer envelopes */
  createdAt: number;
}

function nsecCacheKey(pubkey: string): string {
  return `notifications_nsec:${pubkey}`;
}

function loadNsecCache(pubkey: string): NsecCache | null {
  try {
    const raw = localStorage.getItem(nsecCacheKey(pubkey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "hexKey" in parsed &&
      "eventId" in parsed &&
      "createdAt" in parsed &&
      typeof (parsed as NsecCache).hexKey === "string" &&
      typeof (parsed as NsecCache).eventId === "string" &&
      typeof (parsed as NsecCache).createdAt === "number"
    ) {
      return parsed as NsecCache;
    }
    return null;
  } catch {
    return null;
  }
}

function saveNsecCache(pubkey: string, cache: NsecCache): void {
  try {
    localStorage.setItem(nsecCacheKey(pubkey), JSON.stringify(cache));
  } catch {
    // ignore
  }
}

function clearNsecCache(pubkey: string): void {
  try {
    localStorage.removeItem(nsecCacheKey(pubkey));
  } catch {
    // ignore
  }
}

/**
 * Synchronously derive the notification pubkey from the localStorage cache.
 *
 * Returns null if no valid cache entry exists (first-ever login, or cache
 * was cleared). In that case the caller should fall back to the two-step
 * fetch approach and let getOrCreateNotificationSigner populate the cache.
 */
export function getCachedNotificationPubkey(userPubkey: string): string | null {
  const cache = loadNsecCache(userPubkey);
  if (!cache) return null;
  try {
    return getPublicKey(hexToBytes(cache.hexKey));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dedicated notification signer — one per user pubkey
// ---------------------------------------------------------------------------

/** In-memory cache so we only resolve once per session */
const signerCache = new Map<string, PrivateKeySigner>();

/**
 * Resolve the dedicated PrivateKeySigner for a user's notification state.
 *
 * Resolution order:
 *   1. In-memory cache (fastest — already resolved this session)
 *   2. localStorage cache — valid only if the cached event ID matches the
 *      current envelope in the EventStore (same event = same key). If the
 *      EventStore has a newer envelope (higher created_at), the cache is
 *      invalidated and we fall through to decrypt the new one.
 *   3. EventStore — envelope in store, decrypt with user signer
 *   4. Generate a new nsec, publish the envelope, cache the result
 *
 * Returns null if the user's signer is unavailable (e.g. account switched).
 */
export async function getOrCreateNotificationSigner(
  pubkey: string,
): Promise<PrivateKeySigner | null> {
  // 1. In-memory cache
  const cached = signerCache.get(pubkey);
  if (cached) return cached;

  // Look up the current envelope in the EventStore so we can validate the cache
  const nsecFilter = {
    kinds: [NIP78_KIND],
    authors: [pubkey],
    "#d": [NOTIFICATION_NSEC_D_TAG],
  } as Filter;
  const currentEnvelope = eventStore.getByFilters(nsecFilter)[0] as
    | NostrEvent
    | undefined;

  // 2. localStorage cache — valid only if the current envelope in the store
  //    matches our cached one per NIP-01 ordering: a different envelope wins
  //    if it has a newer created_at, or equal created_at AND a lexicographically
  //    lower id. The simple created_at <= comparison was not enough: when two
  //    clients independently publish their first envelope within the same
  //    second, both timestamps are equal and `<=` returned true for the loser,
  //    leaving each client stuck on its own self-published cache forever.
  const nsecCache = loadNsecCache(pubkey);
  if (nsecCache) {
    let cacheIsValid: boolean;
    if (!currentEnvelope) {
      cacheIsValid = true;
    } else if (currentEnvelope.id === nsecCache.eventId) {
      cacheIsValid = true;
    } else if (currentEnvelope.created_at !== nsecCache.createdAt) {
      // Strictly older store event => cache wins; strictly newer => cache stale
      cacheIsValid = currentEnvelope.created_at < nsecCache.createdAt;
    } else {
      // Equal timestamps — NIP-01 tie-breaker: lower id wins.
      // Cache is still valid only if the cached event has the lower id.
      cacheIsValid = nsecCache.eventId < currentEnvelope.id;
    }

    if (cacheIsValid) {
      try {
        const signer = PrivateKeySigner.fromKey(hexToBytes(nsecCache.hexKey));
        signerCache.set(pubkey, signer);
        return signer;
      } catch {
        // Corrupted cache entry — fall through to re-derive
        clearNsecCache(pubkey);
      }
    } else {
      // A winning envelope has arrived — invalidate the stale cache
      clearNsecCache(pubkey);
    }
  }

  // Need the user's signer for steps 3 and 4
  const { accounts } = await import("@/services/accounts");
  const active = accounts.active$.getValue();
  if (!active || active.pubkey !== pubkey) return null;
  const userSigner = active.signer;

  // 3. Decrypt the envelope from the EventStore
  if (currentEnvelope) {
    try {
      if (!isAppDataUnlocked(currentEnvelope)) {
        await unlockAppData(currentEnvelope, userSigner);
      }
      const content = getAppDataContent<{ nsec: string }>(currentEnvelope);
      if (content?.nsec) {
        const signer = PrivateKeySigner.fromKey(hexToBytes(content.nsec));
        signerCache.set(pubkey, signer);
        saveNsecCache(pubkey, {
          hexKey: content.nsec,
          eventId: currentEnvelope.id,
          createdAt: currentEnvelope.created_at,
        });
        return signer;
      }
    } catch {
      // Decryption failed — fall through to generate a new one
    }
  }

  // 4. Generate a fresh nsec and publish the envelope
  const secretKey = generateSecretKey();
  const hexKey = bytesToHex(secretKey);

  try {
    const { outboxStore } = await import("@/services/outbox");

    // Encrypted (NIP-44) envelope signed by the user's own signer.
    // Use .as(userSigner).encryptedContent() rather than passing "nip44" to
    // AppDataFactory.create() — the create() static method calls .data()
    // internally before the signer is set on the factory, so the signer
    // captured in the setHiddenContent closure is always undefined and the
    // encrypt step throws silently.
    const userPubkey = await userSigner.getPublicKey();
    const signed = await AppDataFactory.create<{ nsec: string }>(
      NOTIFICATION_NSEC_D_TAG,
      { nsec: hexKey },
    )
      .as(userSigner)
      .encryptedContent(userPubkey, JSON.stringify({ nsec: hexKey }), "nip44")
      .sign();

    // Add to local store immediately
    eventStore.add(signed);

    await outboxStore.publish(signed, nsecEnvelopeGroupIds(pubkey), {
      hidden: true,
    });

    // Cache against the published event's metadata
    saveNsecCache(pubkey, {
      hexKey,
      eventId: signed.id,
      createdAt: signed.created_at,
    });
  } catch (err) {
    console.warn("[notifications] Failed to publish nsec envelope:", err);
    // Still proceed — we have the key in memory even if publish failed
  }

  const signer = PrivateKeySigner.fromKey(secretKey);
  signerCache.set(pubkey, signer);
  return signer;
}

/**
 * Evict the in-memory signer cache for a pubkey.
 * Called when the active account changes so stale signers don't linger.
 */
export function evictNotificationSigner(pubkey: string): void {
  signerCache.delete(pubkey);
}

// ---------------------------------------------------------------------------
// Relay group IDs
// ---------------------------------------------------------------------------

/**
 * Group IDs for the nsec envelope (authored by the user's pubkey).
 * Only publishes to the user's outbox relays — index relays reject kind 30078.
 */
function nsecEnvelopeGroupIds(pubkey: string): string[] {
  return [`outbox:${pubkey}`];
}

/**
 * Group IDs for the notification state event (authored by the dedicated
 * notification keypair). Publishes to the user's outbox relays, falling back
 * to "fallback-relays" if none are configured.
 */
function stateEventGroupIds(pubkey: string): string[] {
  return [`outbox:${pubkey}`, "fallback-relays"];
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

const PUBLISH_DEBOUNCE_MS = 2000;

export async function publishReadState(
  pubkey: string,
  state: NotificationReadState,
  holder?: PublishTimerHolder,
): Promise<void> {
  try {
    const notifSigner = await getOrCreateNotificationSigner(pubkey);
    if (!notifSigner) return;
    const { outboxStore } = await import("@/services/outbox");

    // Encrypt + sign with the dedicated notification keypair (self-encrypt:
    // pubkey == author so decryption works symmetrically).
    // Use .as(notifSigner).encryptedContent() rather than passing "nip44" to
    // AppDataFactory.create() — the create() static method calls .data()
    // internally before the signer is set on the factory, so the signer
    // captured in the setHiddenContent closure is always undefined and the
    // encrypt step throws silently.
    const notifPubkey = await notifSigner.getPublicKey();
    const signed = await AppDataFactory.create<NotificationReadState>(
      NOTIFICATION_STATE_D_TAG,
      state,
    )
      .as(notifSigner)
      .encryptedContent(notifPubkey, JSON.stringify(state), "nip44")
      .sign();

    // Record the timestamp of this publish so watchNip78Event can distinguish
    // our own events from events published by another device/tab.
    if (holder) holder.lastPublishedStateAt = signed.created_at;

    // Add to local store immediately for optimistic updates
    eventStore.add(signed);

    await outboxStore.publish(signed, stateEventGroupIds(pubkey), {
      hidden: true,
    });
  } catch (err) {
    console.warn("[notifications] Failed to publish read state:", err);
  }
}

export interface PublishTimerHolder {
  publishTimer: ReturnType<typeof setTimeout> | null;
  lastPublishedStateAt: number;
}

export function schedulePublish(
  pubkey: string,
  readState$: BehaviorSubject<NotificationReadState>,
  holder: PublishTimerHolder,
): void {
  if (holder.publishTimer) clearTimeout(holder.publishTimer);
  holder.publishTimer = setTimeout(() => {
    holder.publishTimer = null;
    publishReadState(pubkey, readState$.getValue(), holder);
  }, PUBLISH_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Watch + decrypt + merge
// ---------------------------------------------------------------------------

/**
 * Subscribe to the NIP-78 nsec envelope in the EventStore.
 *
 * Whenever the envelope changes (new event from another device), we:
 *   1. Evict the in-memory signer cache so getOrCreateNotificationSigner
 *      re-evaluates against the new envelope and the localStorage cache.
 *   2. Re-resolve the notification signer (which will invalidate the
 *      localStorage cache if the envelope is newer, then decrypt).
 *   3. Update notifPubkey$ with the (potentially new) notification pubkey so
 *      the outbox relay subscription in notificationStore.ts rebuilds its
 *      filter and fetches the new state event from relays.
 *   4. Re-subscribe to the state event in the EventStore under the new pubkey
 *      and merge any updated state into readState$.
 *
 * @param notifPubkey$ - BehaviorSubject owned by notificationStore. Updated
 *   here whenever the notification pubkey changes so the outbox relay
 *   subscription can rebuild its filter reactively.
 *
 * Returns the RxJS Subscription so the caller can unsubscribe on cleanup.
 */
export function watchNip78Event(
  pubkey: string,
  readState$: BehaviorSubject<NotificationReadState>,
  notifPubkey$: BehaviorSubject<string | null>,
  holder: PublishTimerHolder,
): Subscription {
  const nsecFilter = {
    kinds: [NIP78_KIND],
    authors: [pubkey],
    "#d": [NOTIFICATION_NSEC_D_TAG],
  } as Filter;

  // Track the envelope event ID we last processed. timeline() can re-emit the
  // same event (e.g. on unrelated store updates), so we skip unless the ID
  // actually changes — avoiding unnecessary signer eviction and potential
  // remote-signer round-trips on re-publishes that don't rotate the key.
  let lastEnvelopeId: string | null = null;

  // The state-event subscription is keyed by the notification pubkey it watches.
  // When the nsec rotates and the notification pubkey changes, we tear down the
  // old subscription and open a new one for the new pubkey.
  let stateEventSub: Subscription | null = null;
  let watchedNotifPubkey: string | null = null;

  const nsecSub = eventStore.timeline([nsecFilter]).subscribe({
    next: async (events) => {
      const evts = events as NostrEvent[];
      if (evts.length === 0) return;

      const envelope = evts[0];

      // Skip if the envelope hasn't changed — avoids evicting the in-memory
      // signer (and potentially triggering a remote-signer decrypt) when
      // timeline() re-emits due to unrelated store activity.
      if (envelope.id === lastEnvelopeId) return;
      lastEnvelopeId = envelope.id;

      // Evict the in-memory signer so getOrCreateNotificationSigner re-checks
      // the localStorage cache validity against the new envelope. If the
      // envelope is newer than our cached one, getOrCreateNotificationSigner
      // will clear the localStorage cache and decrypt the new envelope,
      // replacing both the in-memory signer and the localStorage cache.
      evictNotificationSigner(pubkey);

      try {
        const notifSigner = await getOrCreateNotificationSigner(pubkey);
        if (!notifSigner) return;

        const notifPubkey = await notifSigner.getPublicKey();

        // Notify the store so the outbox relay subscription rebuilds its
        // filter to include the new notification pubkey. This is the key step
        // that ensures the new state event is fetched from relays when the
        // nsec rotates on another device.
        if (notifPubkey !== notifPubkey$.getValue()) {
          notifPubkey$.next(notifPubkey);
        }

        // If the notification pubkey hasn't changed (same nsec, just
        // re-published), the EventStore state subscription is still correct.
        if (notifPubkey === watchedNotifPubkey) return;

        // Tear down the old state subscription (different notification pubkey)
        stateEventSub?.unsubscribe();
        watchedNotifPubkey = notifPubkey;

        const stateFilter = {
          kinds: [NIP78_KIND],
          authors: [notifPubkey],
          "#d": [NOTIFICATION_STATE_D_TAG],
        } as Filter;

        stateEventSub = eventStore.timeline([stateFilter]).subscribe({
          next: async (stateEvents) => {
            const sevts = stateEvents as NostrEvent[];
            if (sevts.length === 0) return;
            const latest = sevts[0];

            try {
              if (!isAppDataUnlocked(latest)) {
                await unlockAppData(latest, notifSigner);
              }

              const content = getAppDataContent<NotificationReadState>(latest);
              if (!content) return;

              const relayState = parseReadState(content);
              const currentLocal = readState$.getValue();

              // If the relay state event is strictly newer than the last event
              // we published ourselves, it came from another device/tab and
              // should replace local state outright — merging would silently
              // undo reversals like "mark as unread" (which lower rb or remove
              // IDs from ri) because mergeReadStates only ever advances state.
              //
              // If it's the same age or older (our own echo from the relay, or
              // a race between two tabs), merge so we don't lose any IDs the
              // relay might have that we don't.
              let next: NotificationReadState;
              if (latest.created_at > holder.lastPublishedStateAt) {
                next = relayState;
              } else {
                next = mergeReadStates(currentLocal, relayState);
              }

              if (JSON.stringify(next) !== JSON.stringify(currentLocal)) {
                readState$.next(next);
              }
            } catch {
              // Decryption failed
            }
          },
        });
      } catch {
        // Signer unavailable or decryption failed
      }
    },
  });

  // Return a composite subscription that tears down both
  return {
    unsubscribe: () => {
      nsecSub.unsubscribe();
      stateEventSub?.unsubscribe();
    },
    closed: false,
  } as Subscription;
}
