import { Relay, type Filter, type NostrEvent } from 'nostr-tools';
import db from '$lib/dbs/LocalDb';
import { issue_kind, patch_kind, proposal_status_kinds, repo_kind } from '$lib/kinds';
import { addSeenRelay, getEventUID, unixNow } from 'applesauce-core/helpers';
import type {
	PubKeyString,
	WebSocketUrl,
	RelayCheckTimestamp,
	RelayUpdate,
	Timestamp,
	ARefR,
	RepoRef
} from '$lib/types';
import { Metadata, RelayList } from 'nostr-tools/kinds';
import type Processor from '$lib/processors/Processor';
import { eventKindToTable } from '$lib/processors/Processor';
import { aRefPToAddressPointer, getRepoRefs } from '$lib/utils';
import type { Subscription } from 'nostr-tools/abstract-relay';
import { repoTableItemToRelayCheckTimestamp } from './RelaySelection';

export class RelayManager {
	url: WebSocketUrl;
	processor: Processor;
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
								uuid: getEventUID(event),
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

	fetching_pubkey_queue = false;
	async fetchPubkeyQueue() {
		if (this.fetching_pubkey_queue === true) {
			return setTimeout(() => {
				this.fetchPubkeyQueue();
			}, 1);
		}

		if (this.pubkey_metadata_queue.size === 0) return;
		this.fetching_pubkey_queue = true;
		await this.connect();
		const filters = createPubkeyFiltersGroupedBySince(this.pubkey_metadata_queue);
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
							uuid: getEventUID(event) as ARefR,
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
								uuid: `${Metadata}:${pubkey}` as ARefR,
								table: 'pubkeys',
								url: this.url
							});
						} else {
							if (!found_metadata.has(pubkey)) {
								this.processor.enqueueRelayUpdate({
									type: 'not-found',
									uuid: `${Metadata}:${pubkey}` as ARefR,
									table: 'pubkeys',
									url: this.url
								});
							}
							if (!found_metadata.has(pubkey)) {
								this.processor.enqueueRelayUpdate({
									type: 'not-found',
									uuid: `${RelayList}:${pubkey}` as ARefR,
									table: 'pubkeys',
									url: this.url
								});
							}
						}
					}
				}
				this.fetching_pubkey_queue = false;
			}
		});
	}

	repo_queue: Map<RepoRef, RelayCheckTimestamp> = new Map();
	set_repo_queue_timeout: ReturnType<typeof setTimeout> | undefined = undefined;
	fetch_repo_promises = new PromiseManager<RepoRef, undefined>();

	async fetchRepo(a_ref: RepoRef, check_timestamp: RelayCheckTimestamp) {
		if (!this.repo_queue.has(a_ref)) {
			this.repo_queue.set(a_ref, check_timestamp);
			await this.connect();
			if (!this.set_repo_queue_timeout) {
				this.set_repo_queue_timeout = setTimeout(async () => {
					this.fetchRepoQueue();
				}, 200);
			}
		}
		await this.fetch_repo_promises.addPromise(a_ref, 20 * 1000);
	}

	fetching_repo_queue = false;

	async fetchRepoQueue() {
		if (this.fetching_repo_queue === true) {
			return setTimeout(() => {
				this.fetchRepoQueue();
			}, 1);
		}

		if (this.repo_queue.size === 0) return;
		this.fetching_repo_queue = true;
		await this.connect();
		// read to process the queue
		const a_refs = new Map(this.repo_queue);
		this.repo_queue.clear();
		clearTimeout(this.set_repo_queue_timeout);
		this.set_repo_queue_timeout = undefined;
		// add all repos with same identifier to queue
		(
			await db.repos
				.where('identifier')
				.anyOf([...new Set<RepoRef>([...a_refs.keys()])])
				.toArray()
		).forEach((record) => {
			a_refs.set(record.uuid, repoTableItemToRelayCheckTimestamp(record, this.url));
		});
		// next bit
		const found_a_ref = new Set<RepoRef>();
		const searched_a_refs = new Set<RepoRef>(a_refs.keys());
		const found_children = new Set<RepoRef>();

		const filters = [...createRepoIdentifierFilters(a_refs), ...createRepoChildrenFilters(a_refs)];

		const onevent = (event: NostrEvent) => {
			if (event.kind === repo_kind) {
				addSeenRelay(event, this.url);
				const repo_ref = getEventUID(event) as RepoRef;
				this.processor.enqueueRelayUpdate({
					type: 'found',
					uuid: repo_ref,
					created_at: event.created_at,
					table: 'repos',
					url: this.url
				});
				this.processor.enqueueEvent(event);
				found_a_ref.add(repo_ref);
			} else if (event.kind === issue_kind || event.kind === patch_kind) {
				addSeenRelay(event, this.url);
				this.processor.enqueueRelayUpdate({
					type: 'found',
					uuid: event.id,
					table: event.kind === issue_kind ? 'issues' : 'prs',
					url: this.url
				});
				this.processor.enqueueEvent(event);
				getRepoRefs(event).forEach((repo_ref) => {
					found_children.add(repo_ref);
				});
			} else {
				// TODO statuses
			}
		};
		const onEose = (sub: Subscription) => {
			sub.close();
			this.resetInactivityTimer();
			for (const a_ref of searched_a_refs) {
				if (filters.some((f) => f['#d'] && f['#d'].includes(a_ref) && !f.since)) {
					this.processor.enqueueRelayUpdate({
						type: 'checked',
						uuid: a_ref,
						table: 'repos',
						url: this.url
					});
				} else {
					if (!found_a_ref.has(a_ref)) {
						this.processor.enqueueRelayUpdate({
							type: 'not-found',
							uuid: a_ref,
							table: 'repos',
							url: this.url
						});
					}
				}
			}
			// TODO process found_children for relay huristics
			found_a_ref.intersection(searched_a_refs).forEach((a_ref) => {
				this.fetch_repo_promises.resolvePromises(a_ref);
			});
			// search for children of newly found a_refs (perhaps from other maintainers)
			const discovered_a_refs = found_a_ref.difference(searched_a_refs);
			if (discovered_a_refs.size > 0) {
				this.relay.subscribe(createRepoChildrenFilters(discovered_a_refs), {
					onevent,
					oneose: () => {
						// TODO process found_children for relay huristics
						this.fetching_repo_queue = false;
					}
				});
			} else {
				this.fetching_repo_queue = false;
			}
		};
		const sub = this.relay.subscribe(filters, {
			onevent,
			oneose: () => {
				onEose(sub);
			}
		});
	}
}

const replication_delay = 15 * 60; // 900 seconds

export const createPubkeyFiltersGroupedBySince = (
	items: Map<PubKeyString, RelayCheckTimestamp>
) => {
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

export const createRepoIdentifierFilters = (items: Map<RepoRef, RelayCheckTimestamp>) => {
	const identifiers = new Map<string, number>();

	items.forEach((t, a_ref) => {
		const identifier = aRefPToAddressPointer(a_ref).identifier;
		const map_entry = identifiers.get(identifier) || 0;
		identifiers.set(
			identifier,
			Math.min(map_entry, t.last_check ? t.last_check - replication_delay : 0)
		);
	});
	const filters: Filter[] = [];
	identifiers.forEach((since, identifier) => {
		filters.push({
			kinds: [repo_kind],
			'#d': [identifier],
			since
		});
	});
	// TODO this could be improved to group by since like we do with pubkeys
	return filters;
};

export const createRepoChildrenFilters = (
	items: Map<RepoRef, RelayCheckTimestamp> | Set<RepoRef>
) => {
	if (items instanceof Set) {
		return [
			{
				kinds: [issue_kind, patch_kind, ...proposal_status_kinds],
				'#a': [...items]
			}
		];
	}
	const sinces = new Map<number, RepoRef[]>();
	const filters: Filter[] = [];
	items.forEach((t, a_ref) => {
		const since = t.last_check ? t.last_check - replication_delay : 0;
		const map_item = sinces.get(since) || [];
		map_item.push(a_ref);
		sinces.set(since, map_item);
	});
	sinces.forEach((a_refs, since) => {
		const filter: Filter = {
			kinds: [issue_kind, patch_kind, ...proposal_status_kinds],
			'#a': a_refs
		};
		if (since > 0) {
			filter.since = since;
		}
		filters.push(filter);
	});
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
