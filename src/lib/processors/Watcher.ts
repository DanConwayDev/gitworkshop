import { addEventsToCache, isInCache } from '$lib/dbs/LocalRelayDb';
import { isRelayUpdatePubkey, type ARef, type EventIdString, type RelayUpdate } from '$lib/types';
import type { EventStore } from 'applesauce-core';
import { processRepoAnnUpdates } from './RepoAnn';
import type { NostrEvent } from 'nostr-tools';
import { getEventUID } from 'applesauce-core/helpers';
import { repo_kind } from '$lib/kinds';
import { Metadata, RelayList } from 'nostr-tools/kinds';
import processPubkey from './Pubkey';
import type { WatcherUpdate } from '$lib/types/watcher';

class Watcher {
	/// this prevents multiple processes from attempting to update the same database line
	/// at the same time and causing some updates to be lost. it's basically
	/// a work-around for the lack of support for locking of idb data items
	/// but also a way of batch updates (relay updates are frequent) for efficency
	///
	/// watches in memory database for inserted nostr events that didnt originate
	/// from the cache and processes them in a queue rather than async. short delay
	/// introduced to batch event updates that change the same table to reduce
	/// reactivity computation
	///
	/// RelayUpdates are manually added via enqueueRelayUpdate which will be
	/// in batches based on uuid, one every Xms or when event with uuid is received

	event_queue: NostrEvent[] = [];
	relay_update_queue: RelayUpdate[] = [];
	running: boolean = false;

	constructor(EventStore: EventStore) {
		EventStore.database.inserted.subscribe((event) => {
			if (!isInCache(event)) this.enqueueEvent(event);
		});
		// to process relay updates for the next uuid in queue every Xms
		setInterval(() => this.nextRelayUpdateBatch(), 1000);
	}

	enqueueRelayUpdate(update: RelayUpdate) {
		this.relay_update_queue.push(update);
	}

	enqueueEvent(event: NostrEvent) {
		this.event_queue.push(event);
		this.nextEventBatch();
	}

	async nextEventBatch() {
		if (this.running) return;
		const events = this.takeEventTableBatch();
		if (events) {
			this.running = true;
			await processUpdates(
				events.map((event) => ({
					event,
					relay_updates: this.takeUIDBatchFromRelayUpdatesQueue(getEventUID(event)) || []
				}))
			);
			if (this.running) setTimeout(() => this.nextEventBatch(), 100);
			this.running = false;
		}
	}

	takeEventTableBatch(): [NostrEvent, ...NostrEvent[]] | undefined {
		if (!this.event_queue[0]) return undefined;
		const table = eventKindToTable(this.event_queue[0].kind);
		if (!table) {
			//event shouldnt be here
			this.event_queue.shift();
			return undefined;
		}
		const relates_to_table: NostrEvent[] = [];
		this.event_queue = this.event_queue.filter((e) => {
			if (eventKindToTable(e.kind) === table) {
				relates_to_table.push(e);
				return false;
			}
			return true;
		});
		if (relates_to_table[0]) return relates_to_table as [NostrEvent, ...NostrEvent[]];
		else return undefined;
	}

	async nextRelayUpdateBatch() {
		if (this.running) return;
		this.running = true;
		const relay_updates_batch = this.takeTableBatchFromRelayUpdatesQueue();
		if (relay_updates_batch) {
			const grouped = groupTableRelayUpdates(relay_updates_batch);
			await processUpdates(grouped);
		}
		this.running = false;
		this.nextEventBatch();
	}

	takeUIDBatchFromRelayUpdatesQueue(
		uuid?: ARef | EventIdString
	): [RelayUpdate, ...RelayUpdate[]] | undefined {
		if (!this.relay_update_queue[0]) return;
		const uuid_to_use = uuid || this.relay_update_queue[0].uuid;
		const relates_to_uuid: RelayUpdate[] = [];
		this.relay_update_queue = this.relay_update_queue.filter((u) => {
			if (u.uuid === uuid_to_use) {
				relates_to_uuid.push(u);
				return false;
			}
			return true;
		});
		if (relates_to_uuid[0]) return relates_to_uuid as [RelayUpdate, ...RelayUpdate[]];
		else return;
	}

	takeTableBatchFromRelayUpdatesQueue(
		table?: 'pubkeys' | 'repos' | 'prs' | 'issues'
	): [RelayUpdate, ...RelayUpdate[]] | undefined {
		if (!this.relay_update_queue[0]) return;
		const relates_to_table: RelayUpdate[] = [];
		const table_to_use = table || this.relay_update_queue[0].table;
		this.relay_update_queue = this.relay_update_queue.filter((u) => {
			if (u.table === table_to_use) {
				relates_to_table.push(u);
				return false;
			}
			return true;
		});
		if (relates_to_table[0]) return relates_to_table as [RelayUpdate, ...RelayUpdate[]];
		else return;
	}
}

async function processUpdates(updates: WatcherUpdate[]) {
	await processRepoAnnUpdates(updates);
	await processPubkey(updates);
	addEventsToCache(updates.map((u) => u.event).filter((e) => e) as NostrEvent[]);
}

export function eventKindToTable(
	kind: number
): ('pubkeys' | 'repos' | 'prs' | 'issues') | undefined {
	if (kind === repo_kind) return 'repos';
	if ([Metadata, RelayList].includes(kind)) return 'pubkeys';
	return undefined;
}

function groupTableRelayUpdates(relay_updates: [RelayUpdate, ...RelayUpdate[]]): WatcherUpdate[] {
	const map: Map<string, WatcherUpdate> = new Map();
	relay_updates.forEach((u) => {
		const key = isRelayUpdatePubkey(u) ? u.uuid.split(':')[1] : u.uuid;
		const e = map.get(key) || { event: undefined, relay_updates: [] };
		e.relay_updates.push(u);
	});
	return [...map.values()];
}

export default Watcher;
