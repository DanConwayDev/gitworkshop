import { type ARef, type PubKeyString, type WebSocketUrl } from '$lib/types';
import { Relay, type Filter } from 'nostr-tools';
import db from '$lib/dbs/LocalDb';
import { repo_kind } from '$lib/kinds';
import { addSeenRelay, getEventUID, unixNow } from 'applesauce-core/helpers';
import type { RelayCheckTimestamp, RelayUpdate, Timestamp } from '$lib/types';
import { Metadata, RelayList } from 'nostr-tools/kinds';
import type Processor from '$lib/processors/Processor';
import { eventKindToTable } from '$lib/processors/Processor';

export class RelayManager {
	url: WebSocketUrl;
	processor: Processor;
	repo_queue: Set<ARef> = new Set();
	set_repo_queue_timeout: ReturnType<typeof setTimeout> | undefined = undefined;
	relay: Relay;
	inactivity_timer: NodeJS.Timeout | null = null;

	constructor(url: WebSocketUrl, processor: Processor) {
		this.url = url;
		this.processor = processor;
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
		}, 60000); // 60 seconds of inactivity
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
							this.processor.enqueueRelayUpdate({
								type: 'found',
								uuid: getEventUID(event) as ARef,
								created_at: event.created_at,
								table,
								url: this.url
							} as RelayUpdate);
						}
						this.processor.enqueueEvent(event);
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

	pubkey_metadata_queue: Map<PubKeyString, RelayCheckTimestamp> = new Map();
	set_pubkey_queue_timeout: ReturnType<typeof setTimeout> | undefined = undefined;
	fetch_pubkey_info_promises = new PromiseManager<PubKeyString, undefined>();

	async fetchPubkeyInfo(pubkey: PubKeyString, check_timestamp: RelayCheckTimestamp) {
		if (!this.pubkey_metadata_queue.has(pubkey)) {
			this.pubkey_metadata_queue.set(pubkey, check_timestamp);
			await this.connect();
			if (!this.set_pubkey_queue_timeout) {
				this.set_pubkey_queue_timeout = setTimeout(async () => {
					this.fetchPubkeyQueue();
				}, 200);
			}
		}
		await this.fetch_pubkey_info_promises.addPromise(pubkey, 10 * 1000);
	}

	fetching_queue = false;
	async fetchPubkeyQueue() {
		if (this.fetching_queue === true) {
			return setTimeout(() => {
				this.fetchPubkeyQueue();
			}, 1);
		}

		if (this.pubkey_metadata_queue.size === 0) return;
		this.fetching_queue = true;
		await this.connect();
		const filters = createFiltersGroupedBySince(this.pubkey_metadata_queue);
		this.pubkey_metadata_queue.clear();
		clearTimeout(this.set_pubkey_queue_timeout);
		this.set_pubkey_queue_timeout = undefined;
		const found_metadata = new Set<string>();
		const found_relay_list = new Set<string>();
		const sub = this.relay.subscribe(filters, {
			onevent: async (event) => {
				if (event.kind === Metadata || event.kind === RelayList) {
					try {
						addSeenRelay(event, this.url);
						this.processor.enqueueRelayUpdate({
							type: 'found',
							uuid: getEventUID(event) as ARef,
							created_at: event.created_at,
							table: 'pubkeys',
							url: this.url
						});
						this.processor.enqueueEvent(event);
						this.fetch_pubkey_info_promises.resolvePromises(event.pubkey);
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
						this.fetch_pubkey_info_promises.resolvePromises(pubkey);
						if (filter.since) {
							this.processor.enqueueRelayUpdate({
								type: 'checked',
								uuid: `${Metadata}:${pubkey}` as ARef,
								table: 'pubkeys',
								url: this.url
							});
						} else {
							if (!found_metadata.has(pubkey)) {
								this.processor.enqueueRelayUpdate({
									type: 'not-found',
									uuid: `${Metadata}:${pubkey}` as ARef,
									table: 'pubkeys',
									url: this.url
								});
							}
							if (!found_metadata.has(pubkey)) {
								this.processor.enqueueRelayUpdate({
									type: 'not-found',
									uuid: `${RelayList}:${pubkey}` as ARef,
									table: 'pubkeys',
									url: this.url
								});
							}
						}
					}
				}
				this.fetching_queue = false;
			}
		});
	}
}

export const createFiltersGroupedBySince = (items: Map<PubKeyString, RelayCheckTimestamp>) => {
	const replication_delay = 15 * 60; // 900 seconds
	const authors_unkown_or_unchecked: PubKeyString[] = [];
	let checked: {
		pubkey: PubKeyString;
		last_update: Timestamp;
		check_from: Timestamp;
	}[] = [];

	const filters: (Filter & {
		authors: string[];
	})[] = [];

	// put aside undefined last check for filter without since
	items.forEach((t, pubkey) => {
		if (!t.last_check || !t.last_update) {
			authors_unkown_or_unchecked.push(pubkey);
		} else {
			checked.push({
				pubkey,
				// sometimes replication delay can be shortened
				check_from: Math.max(t.last_check - replication_delay, t.last_update),
				last_update: t.last_update
			});
		}
	});

	// sort earliest first
	checked.sort((a, b) => a.check_from - b.check_from);

	while (checked.length > 0) {
		const entry = checked.shift();
		if (!entry) continue;

		const filter = {
			kinds: [Metadata, RelayList],
			authors: [entry.pubkey],
			since: entry.check_from
		};

		checked = checked.filter((item) => {
			if (item.check_from >= filter.since && item.last_update <= filter.since) {
				filter.authors.push(item.pubkey);
				return false;
			}
			return true;
		});
		filters.push(filter);
	}

	if (authors_unkown_or_unchecked.length > 0) {
		filters.push({
			kinds: [Metadata, RelayList],
			authors: authors_unkown_or_unchecked
		});
	}
	return filters;
};

class PromiseManager<T, R = void> {
	private promises: Map<T, Promise<R>> = new Map();
	private resolvers: Map<T, (value?: R | PromiseLike<R>) => void> = new Map();
	private timeoutIds: Map<T, NodeJS.Timeout> = new Map();

	// Method to add a new promise for a given key with an optional timeout
	addPromise(key: T, timeout?: number): Promise<R> {
		// If a promise already exists for this key, return it
		if (this.promises.has(key)) {
			return this.promises.get(key)!; // Non-null assertion
		}

		// Create a new promise and store it
		const promise = new Promise<R>((resolve, reject) => {
			this.resolvers.set(key, resolve as (value: R | PromiseLike<R> | undefined) => void);

			// Set a timeout if specified
			if (timeout) {
				const timeoutId = setTimeout(() => {
					reject(new Error(`Promise for key "${key}" timed out after ${timeout} ms`));
					this.cleanup(key); // Clean up on timeout
				}, timeout);
				this.timeoutIds.set(key, timeoutId);
			}
		});

		// Store the promise in the map
		this.promises.set(key, promise);

		// Return the promise
		return promise;
	}

	// Method to resolve all promises for a given key
	resolvePromises(key: T, value?: R): void {
		const resolver = this.resolvers.get(key);
		if (resolver) {
			resolver(value); // Call the resolver function with the provided value
			this.cleanup(key); // Clean up after resolving
		}
	}

	// Cleanup method to remove promise, resolver, and timeout
	private cleanup(key: T): void {
		this.promises.delete(key); // Remove the promise from the map
		this.resolvers.delete(key); // Clean up the resolver
		const timeoutId = this.timeoutIds.get(key);
		if (timeoutId) {
			clearTimeout(timeoutId); // Clear the timeout if it exists
			this.timeoutIds.delete(key); // Clean up the timeout ID
		}
	}
}
