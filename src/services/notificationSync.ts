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

import { BehaviorSubject, firstValueFrom, of } from "rxjs";
import { timeout } from "rxjs/operators";
import { generateSecretKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { PrivateKeySigner } from "applesauce-signers/signers";
import { EventFactory } from "applesauce-core/event-factory";
import { MailboxesModel } from "applesauce-core/models";
import { eventStore } from "@/services/nostr";
import { extraRelays } from "@/services/settings";
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

  // 2. localStorage cache — valid if the envelope hasn't been superseded
  const nsecCache = loadNsecCache(pubkey);
  if (nsecCache) {
    const cacheIsValid =
      // No newer envelope in the store — safe to use cached key
      !currentEnvelope ||
      // Same event — definitely still valid
      currentEnvelope.id === nsecCache.eventId ||
      // Store has an older or equal event — cache is still current
      currentEnvelope.created_at <= nsecCache.createdAt;

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
      // A newer envelope has arrived — invalidate the stale cache
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
    const { factory } = await import("@/services/actions");
    const { outboxStore } = await import("@/services/outbox");
    const { AppDataBlueprint } = await import("applesauce-common/blueprints");

    const draft = await factory.create(
      AppDataBlueprint<{ nsec: string }>,
      NOTIFICATION_NSEC_D_TAG,
      { nsec: hexKey },
      "nip44" as const,
    );
    const signed = await factory.sign(draft);

    // Add to local store immediately
    eventStore.add(signed);

    const relayGroups = await buildNsecEnvelopeRelayGroups(pubkey);
    await outboxStore.publish(signed, relayGroups, { hidden: true });

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
// Relay resolution
// ---------------------------------------------------------------------------

/** Max outbox relays to use from the user's NIP-65 list */
const MAX_OUTBOX_RELAYS = 5;

/**
 * Get the user's NIP-65 outbox relays from the EventStore.
 * Returns an empty array if not loaded within 500ms.
 */
async function getUserOutboxRelays(pubkey: string): Promise<string[]> {
  try {
    const mailboxes = await firstValueFrom(
      eventStore
        .model(MailboxesModel, pubkey)
        .pipe(timeout({ first: 500, with: () => of(undefined) })),
    );
    return mailboxes?.outboxes.slice(0, MAX_OUTBOX_RELAYS) ?? [];
  } catch {
    return [];
  }
}

/**
 * Relay groups for the nsec envelope (authored by the user's pubkey).
 *
 * Only publishes to the user's outbox relays — user index relays (purplepag.es
 * etc.) will reject kind 30078 app data events.
 */
async function buildNsecEnvelopeRelayGroups(
  pubkey: string,
): Promise<Record<string, string[]>> {
  const groups: Record<string, string[]> = {};

  const outboxes = await getUserOutboxRelays(pubkey);
  if (outboxes.length > 0) {
    groups[pubkey] = outboxes;
  }

  return groups;
}

/**
 * Relay groups for the notification state event (authored by the dedicated
 * notification keypair, not the user).
 *
 * Only publishes to the user's outbox relays — lookup relays / NIP-65
 * indexers won't store events from an unknown pubkey. Falls back to
 * extraRelays if the user has no outbox relays configured.
 */
async function buildStateEventRelayGroups(
  pubkey: string,
): Promise<Record<string, string[]>> {
  const groups: Record<string, string[]> = {};

  const outboxes = await getUserOutboxRelays(pubkey);
  if (outboxes.length > 0) {
    groups[pubkey] = outboxes;
  } else {
    // Fallback — user has no NIP-65 outbox relays yet
    const fallback = extraRelays.getValue();
    if (fallback.length > 0) {
      groups["Fallback Relays"] = fallback;
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

const PUBLISH_DEBOUNCE_MS = 2000;

export async function publishReadState(
  pubkey: string,
  state: NotificationReadState,
): Promise<void> {
  try {
    const notifSigner = await getOrCreateNotificationSigner(pubkey);
    if (!notifSigner) return;

    const { AppDataBlueprint } = await import("applesauce-common/blueprints");
    const { outboxStore } = await import("@/services/outbox");

    // Use a temporary EventFactory backed by the dedicated notification signer
    const notifFactory = new EventFactory({ signer: notifSigner });

    const draft = await notifFactory.create(
      AppDataBlueprint<NotificationReadState>,
      NOTIFICATION_STATE_D_TAG,
      state,
      "nip44" as const,
    );
    const signed = await notifFactory.sign(draft);

    // Add to local store immediately for optimistic updates
    eventStore.add(signed);

    const relayGroups = await buildStateEventRelayGroups(pubkey);
    await outboxStore.publish(signed, relayGroups, { hidden: true });
  } catch (err) {
    console.warn("[notifications] Failed to publish read state:", err);
  }
}

export interface PublishTimerHolder {
  publishTimer: ReturnType<typeof setTimeout> | null;
}

export function schedulePublish(
  pubkey: string,
  readState$: BehaviorSubject<NotificationReadState>,
  holder: PublishTimerHolder,
): void {
  if (holder.publishTimer) clearTimeout(holder.publishTimer);
  holder.publishTimer = setTimeout(() => {
    holder.publishTimer = null;
    publishReadState(pubkey, readState$.getValue());
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
 *   3. Re-subscribe to the state event under the (potentially new) notification
 *      pubkey and merge any updated state into readState$.
 *
 * Returns the RxJS Subscription so the caller can unsubscribe on cleanup.
 */
export function watchNip78Event(
  pubkey: string,
  readState$: BehaviorSubject<NotificationReadState>,
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
      // the localStorage cache validity against the new envelope.
      evictNotificationSigner(pubkey);

      try {
        const notifSigner = await getOrCreateNotificationSigner(pubkey);
        if (!notifSigner) return;

        const notifPubkey = await notifSigner.getPublicKey();

        // If the notification pubkey hasn't changed (same nsec, just
        // re-published), the state subscription is still correct.
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
              const merged = mergeReadStates(currentLocal, relayState);

              if (JSON.stringify(merged) !== JSON.stringify(currentLocal)) {
                readState$.next(merged);
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
