import { chooseRelaysForAllRepos, chooseRelaysForPubkey } from '$lib/relay/RelaySelection';
import { RelayManager } from '$lib/relay/RelayManager';
import type { AtLeastThreeArray, PubKeyString, WebSocketUrl } from '$lib/types';
import { unixNow } from 'applesauce-core/helpers';
import { getCacheEventsForFilters } from '$lib/dbs/LocalRelayDb';
import { repo_kind } from '$lib/kinds';
import type { Filter } from 'nostr-tools';
import { Metadata, RelayList } from 'nostr-tools/kinds';
import Processor from '$lib/processors/Processor';
import db from '$lib/dbs/LocalDb';

export const base_relays: AtLeastThreeArray<WebSocketUrl> = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band',
	'wss://purplerelay.com' // reliability untested
];

class QueryCentreExternal {
	// processor = new Processor(self.postMessage);
	processor = new Processor((event) => {
		self.postMessage(event);
	});
	base_relays: WebSocketUrl[] = base_relays;
	relays: Map<WebSocketUrl, RelayManager> = new Map();

	get_relay(url: WebSocketUrl) {
		const relay = this.relays.get(url);
		if (relay) return relay;
		else {
			const relay = new RelayManager(url, this.processor);
			this.relays.set(url, relay);
			return relay;
		}
	}

	hydrated_from_cache_db: Set<string> = new Set();
	async hydrate_from_cache_db(filters: Filter[]) {
		const uid = JSON.stringify(filters);
		if (!this.hydrated_from_cache_db.has(uid)) {
			this.hydrated_from_cache_db.add(uid);
			const cached = await getCacheEventsForFilters(filters);
			cached.forEach((event) => {
				this.processor.enqueueEvent(event);
			});
		}
	}

	async fetchAllRepos() {
		await this.hydrate_from_cache_db([{ kinds: [repo_kind] }]);
		const relays = await chooseRelaysForAllRepos();
		await Promise.all(relays.map((url) => this.get_relay(url).fetchAllRepos()));
	}

	async fetchPubkeyName(pubkey: PubKeyString) {
		await this.hydrate_from_cache_db([{ kinds: [Metadata, RelayList], authors: [pubkey] }]);
		let record = await db.pubkeys.get(pubkey);
		const relays_tried: WebSocketUrl[] = [];
		// only fetch from relays if no metadata in db
		while (!record || !record.metadata.stamp) {
			const relays = (await chooseRelaysForPubkey(pubkey))
				.filter(
					({ url, check_timestamps }) =>
						// skip relays just tried
						!relays_tried.includes(url) &&
						// and relays checked within 30 seconds
						(!check_timestamps.last_check || check_timestamps.last_check < unixNow() - 30 * 1000)
				)
				// try 2 relays at a time, until record is found or ran out of relays
				.slice(0, 2);
			if (relays.length === 0) {
				// TODO lookup all other relays known by LocalDb and try those
				break;
			}
			relays.forEach(({ url }) => relays_tried.push(url));
			try {
				await Promise.all(
					relays.map(({ url, check_timestamps }) =>
						this.get_relay(url).fetchPubkeyInfo(pubkey, check_timestamps)
					)
				);
			} catch {
				/* empty */
			}
			record = await db.pubkeys.get(pubkey);
		}
	}
}

const external = new QueryCentreExternal();

self.onmessage = async (event) => {
	const { method, args } = event.data;
	let result;
	switch (method) {
		case 'fetchAllRepos':
			result = await external.fetchAllRepos();
			break;
		case 'fetchPubkeyName':
			result = await external.fetchPubkeyName(args[0]);
			break;
		default:
			console.error('Unknown method:', method);
			break;
	}

	self.postMessage(result);
};
