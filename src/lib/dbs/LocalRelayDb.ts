import { addEvents, getEventsForFilters, IndexCache, openDB, type NostrIDB } from 'nostr-idb';
import type { Filter, NostrEvent } from 'nostr-tools';
import memory_db from './InMemoryRelay';

let cache_relay_db: NostrIDB | undefined = undefined;
let cache_relay_index: IndexCache | undefined = undefined;

export async function getCacheRelayDb(): Promise<{
	cache_relay_db: NostrIDB;
	cache_relay_index: IndexCache;
}> {
	if (!cache_relay_db) {
		cache_relay_db = await openDB('LocalStorageRelay');
	}
	if (!cache_relay_index) {
		cache_relay_index = new IndexCache();
	}
	return { cache_relay_db, cache_relay_index };
}

export const InCacheSymbol = Symbol.for('in-cache');

declare module 'nostr-tools' {
	export interface Event {
		[InCacheSymbol]?: true;
	}
}

function markInCache(event: NostrEvent) {
	if (!event[InCacheSymbol]) event[InCacheSymbol] = true;
	return event[InCacheSymbol];
}

export function isInCache(event: NostrEvent): boolean {
	return event[InCacheSymbol] || false;
}

export async function getCacheEventsForFilters(filters: Filter[]): Promise<NostrEvent[]> {
	const { cache_relay_db, cache_relay_index } = await getCacheRelayDb();
	const events = await getEventsForFilters(cache_relay_db, filters, cache_relay_index);
	events.forEach((event) => {
		markInCache(event);
		memory_db.add(event);
	});
	return events;
}

export async function addEventsToCache(events: NostrEvent[]) {
	const { cache_relay_db, cache_relay_index } = await getCacheRelayDb();

	for (const event of events) {
		if (!isInCache(event)) {
			await addEvents(cache_relay_db, events);
			cache_relay_index.addEventToIndexes(event);
		}
	}
}
