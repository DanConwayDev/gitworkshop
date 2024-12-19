import { safeRelayUrl } from 'applesauce-core/helpers';
import { chooseRelaysForAllRepos } from '$lib/relay/RelaySelection';
import { RelayManager } from '$lib/relay/RelayManager';

export type WebSocketUrl = `wss://${string}` | `ws://${string}`;

export function isWebSocketUrl(url: string): url is WebSocketUrl {
	return !!safeRelayUrl(url);
}
export const base_relays: WebSocketUrl[] = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band',
	'wss://purplerelay.com' // reliability untested
	// 'wss://relayable.org', // free but not so reliable
];

class QueryCentreExternal {
	base_relays: WebSocketUrl[] = base_relays;
	relays: Map<WebSocketUrl, RelayManager> = new Map();

	get_relay(url: WebSocketUrl) {
		const relay = this.relays.get(url);
		if (relay) return relay;
		else {
			const relay = new RelayManager(url);
			this.relays.set(url, relay);
			return relay;
		}
	}

	async fetchAllRepos() {
		const relays = await chooseRelaysForAllRepos();
		Promise.all(relays.map((url) => this.get_relay(url).fetchAllRepos()));
	}
}

export default QueryCentreExternal;
