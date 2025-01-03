import { type ARef, type PubKeyString, type WebSocketUrl } from '$lib/types';
import { Relay, type Filter } from 'nostr-tools';
import db from '$lib/dbs/LocalDb';
import { repo_kind } from '$lib/kinds';
import { addSeenRelay, getEventUID, unixNow } from 'applesauce-core/helpers';
import memory_db from '$lib/dbs/InMemoryRelay';
import type Watcher from '$lib/processors/Watcher';
import type { RelayCheckTimestamp, RelayUpdate } from '$lib/types';
import { Metadata, RelayList } from 'nostr-tools/kinds';
import { eventKindToTable } from '$lib/processors/Watcher';

export class RelayManager {
	url: WebSocketUrl;
	watcher: Watcher;
	repo_queue: Set<ARef> = new Set();
	pubkey_metadata_queue: Map<PubKeyString, RelayCheckTimestamp> = new Map();
	set_repo_queue_timeout: ReturnType<typeof setTimeout> | undefined = undefined;
	set_pubkey_queue_timeout: ReturnType<typeof setTimeout> | undefined = undefined;
	relay: Relay;
	inactivity_timer: NodeJS.Timeout | null = null;

	constructor(url: WebSocketUrl, watcher: Watcher) {
		this.url = url;
		this.watcher = watcher;
		this.relay = new Relay(url);
	}

	async connect(): Promise<void> {
		this.resetInactivityTimer();
		if (!this.relay.connected) {
			await this.relay.connect();
		}
		if (!this.relay.connected) {
			// nostr-tools relay doesnt reconnect so we create a new one
			this.relay = new Relay(this.url);
		}
		this.resetInactivityTimer();
	}

	resetInactivityTimer() {
		if (this.inactivity_timer) {
			clearTimeout(this.inactivity_timer);
		}
		this.inactivity_timer = setTimeout(() => {
			this.relay.close();
			this.relay = new Relay(this.url);
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
						const table = eventKindToTable(event.kind);
						if (table) {
							this.watcher.enqueueRelayUpdate({
								type: 'found',
								uuid: getEventUID(event) as ARef,
								created_at: event.created_at,
								table,
								url: this.url
							} as RelayUpdate);
						}
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

	async fetchPubkeyInfo(pubkey: PubKeyString, check_timestamp: RelayCheckTimestamp) {
		// TODO: capture last_check and last_created_at
		this.pubkey_metadata_queue.set(pubkey, check_timestamp);
		await this.connect();
		if (!this.set_pubkey_queue_timeout) {
			this.set_pubkey_queue_timeout = setTimeout(async () => this.fetchPubkeyQueue(), 200);
		}
	}

	async fetchPubkeyQueue() {
		await this.connect();
		const filters = createFiltersGroupedBySince(this.pubkey_metadata_queue);
		this.pubkey_metadata_queue.clear();
		clearTimeout(this.set_pubkey_queue_timeout);
		const found_metadata = new Set<string>();
		const found_relay_list = new Set<string>();
		const sub = this.relay.subscribe(filters, {
			onevent: async (event) => {
				if (event.kind === Metadata || event.kind === RelayList) {
					try {
						addSeenRelay(event, this.url);
						this.watcher.enqueueRelayUpdate({
							type: 'found',
							uuid: getEventUID(event) as ARef,
							created_at: event.created_at,
							table: 'pubkeys',
							url: this.url
						});
						memory_db.add(event);
					} catch {
						/* empty */
					}
					(event.kind === Metadata ? found_metadata : found_relay_list).add(event.pubkey);
				}
			},
			oneose: async () => {
				sub.close();
				this.resetInactivityTimer();
				for (const filter of filters) {
					for (const pubkey of filter.authors) {
						if (filter.since) {
							this.watcher.enqueueRelayUpdate({
								type: 'checked',
								uuid: `${Metadata}:${pubkey}` as ARef,
								table: 'pubkeys',
								url: this.url
							});
						} else {
							if (!found_metadata.has(pubkey)) {
								this.watcher.enqueueRelayUpdate({
									type: 'not-found',
									uuid: `${Metadata}:${pubkey}` as ARef,
									table: 'pubkeys',
									url: this.url
								});
							}
							if (!found_metadata.has(pubkey)) {
								this.watcher.enqueueRelayUpdate({
									type: 'not-found',
									uuid: `${RelayList}:${pubkey}` as ARef,
									table: 'pubkeys',
									url: this.url
								});
							}
						}
					}
				}
			}
		});
	}
}

/// create the smallest set of filters to find all (and only) profile events we haven't seen before.
/// it finds the newest event we have (by last_update) and groups all where last_check is greater than this.
/// it repeats this until all pubkeys are included in a filter
/// if we dont have the event (last_update is undefined), its ok either use the last_check or a filter where since is undefined
export function createFiltersGroupedBySince(
	items: Map<PubKeyString, RelayCheckTimestamp>
): (Filter & { authors: string[] })[] {
	const replication_delay = 15 * 60;
	// Sort the items by last_update in descending order, then by last_check in descending order
	const sortedItems = Array.from(items.entries()).sort(([, a], [, b]) => {
		if ((b?.last_update ?? 0) - (a?.last_update ?? 0) === 0) {
			return (b?.last_check ?? 0) - (a?.last_check ?? 0);
		}
		return (b?.last_update ?? 0) - (a?.last_update ?? 0);
	});

	const filters: (Filter & { authors: string[] })[] = [];

	let entry = sortedItems.shift();
	while (entry && entry[1]) {
		const [pubkey, timestamp] = entry;
		const filter = {
			kinds: [Metadata, RelayList],
			authors: [pubkey],
			since: timestamp.last_update
		};
		entry = sortedItems.shift();
		while (entry) {
			const [pubkey, timestamp] = entry;
			if (
				// if !filter.since we dont have any events at this point in the sorted array
				!filter.since ||
				// if our last_check is more recent than 'since' we should only get new events
				(timestamp.last_check && timestamp.last_check - replication_delay > filter.since)
			)
				filter.authors.push(pubkey);
			else break;
			entry = sortedItems.shift();
		}
		filters.push(filter);
	}
	return filters;
}
