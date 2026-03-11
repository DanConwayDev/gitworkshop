import { EventStore } from "applesauce-core";
import { persistEventsToCache, relaySet } from "applesauce-core/helpers";
import {
  createAddressLoader,
  createEventLoaderForStore,
  createReactionsLoader,
  createZapsLoader,
} from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers";
import type { NostrEvent } from "nostr-tools";
import { verifyEvent } from "nostr-tools";
import { cacheRequest, saveEvents } from "./cache";
import { extraRelays, lookupRelays } from "./settings";

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
 * Setup NostrConnectSigner to use the global relay pool.
 * This allows NostrConnectSigner instances to communicate with relays
 * for NIP-46 remote signing.
 */
NostrConnectSigner.pool = pool;

/**
 * Publish an event to the configured relays.
 * Automatically adds the event to the local EventStore.
 *
 * @param event - The signed Nostr event to publish
 * @param relays - Optional array of relay URLs (uses defaultRelays if not provided)
 */
export async function publish(
  event: NostrEvent,
  relays?: string[],
): Promise<void> {
  console.log("Publishing event:", event);

  // Add to local store immediately for optimistic updates
  eventStore.add(event);

  // Publish to relays
  await pool.publish(relaySet(extraRelays.getValue(), relays), event);
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
});
