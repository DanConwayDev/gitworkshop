import { chooseRelaysForAllRepos, chooseRelaysForPubkey } from '$lib/relay/RelaySelection';
import { RelayManager } from '$lib/relay/RelayManager';
import type { AtLeastThreeArray, PubKeyString, Timestamp, WebSocketUrl } from '$lib/types';
import { unixNow } from 'applesauce-core/helpers';
import { getCacheEventsForFilters } from '$lib/dbs/LocalRelayDb';
import { repo_kind } from '$lib/kinds';
import type { Filter } from 'nostr-tools';
import { Metadata, RelayList } from 'nostr-tools/kinds';
import Processor from '$lib/processors/Processor';

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

	pubkey_last_fetch: Map<PubKeyString, Timestamp> = new Map();

	pubkey_fetched_recently(pubkey: PubKeyString, seconds: number): boolean {
		const last = this.pubkey_last_fetch.get(pubkey);
		return !last || last < unixNow() - seconds * 1000;
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

	async fetchPubkey(pubkey: PubKeyString) {
		// if (this.pubkey_fetched_recently(pubkey, 60)) return;
		// this.pubkey_last_fetch.set(pubkey, unixNow());
		await this.hydrate_from_cache_db([{ kinds: [Metadata, RelayList], authors: [pubkey] }]);
		const relays = await chooseRelaysForPubkey(pubkey);
		await Promise.all(
			relays.map(({ url, check_timestamps }) =>
				this.get_relay(url).fetchPubkeyInfo(pubkey, check_timestamps)
			)
		);
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
		case 'fetchPubkey':
			result = await external.fetchPubkey(args[0]);
			break;
		default:
			console.error('Unknown method:', method);
			break;
	}

	self.postMessage(result);
};
