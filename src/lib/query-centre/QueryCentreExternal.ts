import { chooseRelaysForAllRepos, chooseRelaysForPubkey } from '$lib/relay/RelaySelection';
import { RelayManager } from '$lib/relay/RelayManager';
import type { AtLeastThreeArray, PubKeyString, Timestamp, WebSocketUrl } from '$lib/types';
import Watcher from '$lib/processors/Watcher';
import memory_db from '$lib/dbs/InMemoryRelay';
import { unixNow } from 'applesauce-core/helpers';

export const base_relays: AtLeastThreeArray<WebSocketUrl> = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band',
	'wss://purplerelay.com' // reliability untested
	// 'wss://relayable.org', // free but not so reliable
];

class QueryCentreExternal {
	// initiate watcher to begin processing new events
	watcher = new Watcher(memory_db);
	base_relays: WebSocketUrl[] = base_relays;
	relays: Map<WebSocketUrl, RelayManager> = new Map();

	get_relay(url: WebSocketUrl) {
		const relay = this.relays.get(url);
		if (relay) return relay;
		else {
			const relay = new RelayManager(url, this.watcher);
			this.relays.set(url, relay);
			return relay;
		}
	}

	async fetchAllRepos() {
		const relays = await chooseRelaysForAllRepos();
		Promise.all(relays.map((url) => this.get_relay(url).fetchAllRepos()));
	}

	pubkey_last_fetch: Map<PubKeyString, Timestamp> = new Map();
	pubkey_fetched_recently(pubkey: PubKeyString, seconds: number): boolean {
		const last = this.pubkey_last_fetch.get(pubkey);
		return !last || last < unixNow() - seconds * 1000;
	}

	async fetchPubkey(pubkey: PubKeyString) {
		if (this.pubkey_fetched_recently(pubkey, 60)) return;
		this.pubkey_last_fetch.set(pubkey, unixNow());

		const relays = await chooseRelaysForPubkey(pubkey);
		Promise.all(
			relays.map(({ url, check_timestamps }) =>
				this.get_relay(url).fetchPubkeyInfo(pubkey, check_timestamps)
			)
		);
	}
}

export default QueryCentreExternal;
