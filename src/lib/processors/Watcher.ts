import { addEventsToCache, isInCache } from '$lib/dbs/LocalRelayDb';
import type { ARef, EventIdString } from '$lib/dbs/types';
import type { EventStore } from 'applesauce-core';
import processRepoAnn from './RepoAnn';
import type { NostrEvent } from 'nostr-tools';

interface FoundEvent extends NostrEvent {
	url: string;
}

interface RelayUpdate {
	type: 'finding' | 'not-found';
	uuid: EventIdString | ARef;
	table: 'repos' | 'prs' | 'issues';
	url: string;
}

type WatcherEvent = NostrEvent | FoundEvent | RelayUpdate;

function isRelayUpdate(entry: NostrEvent | RelayUpdate): entry is RelayUpdate {
	return 'type' in entry;
}
class Watcher {
	/// watches in memory database for inserted nostr events that didnt originate
	/// from the cache and processes them in a queue rather than async
	/// allows other 'events' to be added to the queue and processed. eg. RelayUpdate
	/// this prevents multiple processes from attempting to update the same database line
	/// at the same time and causing some updates to be lost. it's basically
	/// a work-around for the lack of support for locking of idb data items

	queue: WatcherEvent[] = [];
	running: boolean = false;

	constructor(EventStore: EventStore) {
		EventStore.database.inserted.subscribe((event) => {
			if (!isInCache(event)) this.enqueue(event);
		});
	}

	enqueue(entry: WatcherEvent) {
		this.queue.push(entry);
		this.next();
	}

	async next() {
		if (this.running) return;
		// TODO: could we more efficently process the queue by processing
		//       multiple queue items that are updating the same db item?
		const entry = this.queue.shift();
		if (entry) {
			this.running = true;
			await process(entry);
			if (this.running) setTimeout(() => this.next(), 0);
		}
		this.running = false;
	}
}

async function process(entry: NostrEvent | RelayUpdate) {
	if (isRelayUpdate(entry)) {
		// TODO update seen_on
	} else {
		await processRepoAnn(entry);
		addEventsToCache([entry]);
		// TODO add all processes that update custom db here
	}
}

export default Watcher;
