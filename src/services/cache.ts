import type { Filter, NostrEvent } from "applesauce-core/helpers";
import "window.nostrdb.js";

/**
 * Request events from the IndexedDB cache.
 * Used by event loaders to check cache before querying relays.
 * Returns empty array if cache is not available.
 */
export async function cacheRequest(filters: Filter[]) {
  return window.nostrdb.filters(filters);
}

/** Save events to the cache */
export async function saveEvents(events: NostrEvent[]) {
  await Promise.allSettled(events.map((e) => window.nostrdb.add(e)));
}
