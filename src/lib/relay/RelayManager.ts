import type { ARef, PubKeyString, WebSocketUrl } from '$lib/types';
import { CacheRelay } from 'nostr-idb';
import { Relay } from 'nostr-tools';
import db from '$lib/dbs/LocalDb';
import { repo_kind } from '$lib/kinds';
import { addSeenRelay, getEventUID, unixNow } from 'applesauce-core/helpers';
import memory_db from '$lib/dbs/InMemoryRelay';
import type Watcher from '$lib/processors/Watcher';
import type { EventIdString } from '$lib/types';

export class RelayManager {
	url: WebSocketUrl;
	watcher: Watcher;
	repo_queue: Set<ARef> = new Set();
	pubkey_metadata_queue: Set<PubKeyString> = new Set();
	set_repo_queue_timeout: ReturnType<typeof setTimeout> | undefined = undefined;
	set_pubkey_queue_timeout: ReturnType<typeof setTimeout> | undefined = undefined;
	relay: Relay | CacheRelay;
	inactivity_timer: NodeJS.Timeout | null = null;

	constructor(
		url: WebSocketUrl,
		watcher: Watcher,
		relay: Relay | CacheRelay | undefined = undefined
	) {
		this.url = url;
		this.watcher = watcher;
		if (relay) this.relay = relay;
		else {
			this.relay = new Relay(url);
		}
	}

	async connect(): Promise<void> {
		this.resetInactivityTimer();
		if (!this.relay.connected) {
			await this.relay.connect();
		}
		this.resetInactivityTimer();
	}

	resetInactivityTimer() {
		if (this.inactivity_timer) {
			clearTimeout(this.inactivity_timer);
		}
		this.inactivity_timer = setTimeout(() => {
			this.relay.close();
		}, 10000); // 10 seconds of inactivity
	}

	closeRelayAfterInactivity() {
		this.resetInactivityTimer(); // Start the inactivity timer
	}

	async fetchAllRepos() {
		const checks = await db.last_checks.get(`${this.url}|`);
		if (checks && checks.check_initiated_at && checks.check_initiated_at > Date.now() - 3000)
			return;
		db.last_checks.put({
			url_and_query: `${this.url}|`,
			url: this.url,
			check_initiated_at: Date.now(),
			timestamp: checks ? checks.timestamp : 0,
			// timestamp: unixNow(),
			query: 'All Repos'
		});
		await this.connect();
		return new Promise<void>((r) => {
			const sub = this.relay.subscribe(
				[
					{
						kinds: [repo_kind],
						since: checks ? Math.round(checks.timestamp - 60 * 10) : 0
						// TODO: what if this last check failed to reach the relay?
						// limit: 100,
						// TODO request next batch if 100 recieved
					}
				],
				{
					onevent: async (event) => {
						if (event.kind !== repo_kind) return;
						addSeenRelay(event, this.url);
						this.watcher.enqueueRelayUpdate({
							type: 'found',
							uuid: getEventUID(event) as ARef,
							event_id: event.id as EventIdString,
							table: 'repos',
							url: this.url
						});
						memory_db.add(event);
					},
					oneose: async () => {
						sub.close();
						this.resetInactivityTimer();
						db.last_checks.put({
							url_and_query: `${this.url}|`,
							url: this.url,
							check_initiated_at: undefined,
							timestamp: unixNow(),
							query: 'All Repos'
						});
						r();
					}
				}
			);
		});
	}
}
