import { addEventsToCache, isInCache } from '$lib/dbs/LocalRelayDb';
import type { ARef, EventIdString, RelayUpdate, RelayUpdateRepoAnn } from '$lib/types';
import type { EventStore } from 'applesauce-core';
import processRepoAnn from './RepoAnn';
import type { NostrEvent } from 'nostr-tools';
import { getEventUID } from 'applesauce-core/helpers';
import { repo_kind } from '$lib/kinds';

class Watcher {
	/// this prevents multiple processes from attempting to update the same database line
	/// at the same time and causing some updates to be lost. it's basically
	/// a work-around for the lack of support for locking of idb data items
	/// but also a way of batch updates (relay updates are frequent) for efficency
	///
	/// watches in memory database for inserted nostr events that didnt originate
	/// from the cache and processes them in a queue rather than async
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
		setInterval(() => this.nextRelayUpdateBatch(), 100);
	}

	enqueueRelayUpdate(update: RelayUpdate) {
		this.relay_update_queue.push(update);
	}

	enqueueEvent(event: NostrEvent) {
		this.event_queue.push(event);
		this.next();
	}

	async next() {
		if (this.running) return;
		const event = this.event_queue.shift();
		if (event) {
			this.running = true;
			await processEventAndOrRelayUpdates(
				event,
				this.takeUIDBatchFromRelayUpdatesQueue(getEventUID(event)) || []
			);
			if (this.running) setTimeout(() => this.next(), 0);
			this.running = false;
		}
	}

	async nextRelayUpdateBatch() {
		if (this.running) return;
		this.running = true;
		const relay_updates_batch = this.takeUIDBatchFromRelayUpdatesQueue();
		if (relay_updates_batch) {
			await processEventAndOrRelayUpdates(undefined, relay_updates_batch);
		}
		this.running = false;
		this.next();
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
}

async function processEventAndOrRelayUpdates(
	event: NostrEvent,
	relay_updates?: RelayUpdate[]
): Promise<void>;
async function processEventAndOrRelayUpdates(
	event: undefined,
	relay_updates: [RelayUpdate, ...RelayUpdate[]]
): Promise<void>;

async function processEventAndOrRelayUpdates(
	event: NostrEvent | undefined,
	relay_update_batch: RelayUpdate[] = []
) {
	if (event?.kind === repo_kind)
		await processRepoAnn(event, relay_update_batch as RelayUpdateRepoAnn[]);
	// TODO add all processes that update custom db here
	if (event) addEventsToCache([event]);
}

export default Watcher;
