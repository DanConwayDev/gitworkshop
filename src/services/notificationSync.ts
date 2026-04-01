/**
 * NIP-78 read-state sync for notifications.
 *
 * Two responsibilities:
 *   1. publishReadState — debounced encrypt-and-publish of the current
 *      NotificationReadState to a NIP-78 addressable event so other devices
 *      can pick it up.
 *   2. watchNip78Event — subscribes to the NIP-78 event in the EventStore,
 *      decrypts it when it arrives, and merges it into the local readState$.
 *
 * Both are called from acquireNotificationStore in notificationStore.ts.
 */

import { BehaviorSubject } from "rxjs";
import { eventStore } from "@/services/nostr";
import { lookupRelays } from "@/services/settings";
import {
  parseReadState,
  mergeReadStates,
  NIP78_KIND,
  NOTIFICATION_STATE_D_TAG,
  type NotificationReadState,
} from "@/lib/notifications";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import {
  unlockEncryptedContent,
  isEncryptedContentUnlocked,
  getEncryptedContent,
} from "applesauce-core/helpers/encrypted-content";
import type { Subscription } from "rxjs";

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

const PUBLISH_DEBOUNCE_MS = 2000;

export async function publishReadState(
  pubkey: string,
  state: NotificationReadState,
): Promise<void> {
  try {
    const { accounts } = await import("@/services/accounts");
    const { factory } = await import("@/services/actions");
    const { publish } = await import("@/services/nostr");
    const { AppDataBlueprint } = await import("applesauce-common/blueprints");

    const active = accounts.active$.getValue();
    if (!active || active.pubkey !== pubkey) return;

    const draft = await factory.create(
      AppDataBlueprint<NotificationReadState>,
      NOTIFICATION_STATE_D_TAG,
      state,
      "nip44" as const,
    );
    const signed = await factory.sign(draft);
    await publish(signed, undefined, {
      "User Index Relays": lookupRelays.getValue(),
    });
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
 * Subscribe to the NIP-78 read-state event in the EventStore.
 * When it arrives (or updates), decrypt it and merge into readState$.
 *
 * Returns the RxJS Subscription so the caller can unsubscribe on cleanup.
 */
export function watchNip78Event(
  pubkey: string,
  readState$: BehaviorSubject<NotificationReadState>,
): Subscription {
  const nip78Filter = {
    kinds: [NIP78_KIND],
    authors: [pubkey],
    "#d": [NOTIFICATION_STATE_D_TAG],
  } as Filter;

  return eventStore.timeline([nip78Filter]).subscribe({
    next: async (events) => {
      const evts = events as NostrEvent[];
      if (evts.length === 0) return;
      const latest = evts[0];

      try {
        if (!isEncryptedContentUnlocked(latest)) {
          const { accounts } = await import("@/services/accounts");
          const active = accounts.active$.getValue();
          if (!active || active.pubkey !== pubkey) return;
          await unlockEncryptedContent(latest, pubkey, active.signer);
        }

        const plaintext = getEncryptedContent(latest);
        if (!plaintext) return;

        const relayState = parseReadState(JSON.parse(plaintext));
        const currentLocal = readState$.getValue();
        const merged = mergeReadStates(currentLocal, relayState);

        if (JSON.stringify(merged) !== JSON.stringify(currentLocal)) {
          readState$.next(merged);
        }
      } catch {
        // Decryption failed — signer unavailable or not our event
      }
    },
  });
}
