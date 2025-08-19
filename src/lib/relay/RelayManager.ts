import { matchFilters, Relay, type Filter, type NostrEvent } from 'nostr-tools';
import db from '$lib/dbs/LocalDb';
import { IgnoreKinds, IssueKind, PatchKind, RepoAnnKind } from '$lib/kinds';
import { addSeenRelay, getEventUID, unixNow } from 'applesauce-core/helpers';
import {
	type PubKeyString,
	type WebSocketUrl,
	type RelayCheckTimestamp,
	type ARefR,
	type RepoRef,
	type RelayUpdateRepoAnn,
	type RelayUpdateRepoChildren,
	type EventIdString,
	type RepoCheckLevel,
	type ARefP,
	type RepoTableItem
} from '$lib/types';
import { Metadata, Reaction, RelayList } from 'nostr-tools/kinds';
import type Processor from '$lib/processors/Processor';
import { eventKindToTable } from '$lib/processors/Processor';
import { aRefPToAddressPointer, eventIsPrRoot, getRepoRefs } from '$lib/utils';
import type { Subscription } from 'nostr-tools/abstract-relay';
import { repoTableItemToRelayCheckTimestamp } from './RelaySelection';
import {
	createPubkeyFiltersGroupedBySince,
	createPubkeyNoficiationsFilters,
	createRepoChildrenFilters,
	createRepoChildrenQualityFilters,
	createRepoChildrenStatusAndDeletionFilters,
	createRepoIdentifierFilters
} from './filters';
import {
	createActionDVMProvidersFilter,
	createRecentActionsRequestFilter,
	createRecentActionsResultFilter,
	createWatchActionsFilter
} from './filters/actions';
import type { NEventAttributes } from 'nostr-editor';
import SubscriberManager from '$lib/SubscriberManager';
import { getIssuesAndPrsIdsFromRepoItem } from '$lib/repos';
import type { EventPointer } from 'nostr-tools/nip19';
import { createWalletFilter, createWalletHistoryFilter } from './filters/wallet';

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
			if (this.watch_sub) this.resetInactivityTimer();
			else {
				this.relay.close();
				this.relay = new Relay(this.url);
			}
		}, 60000); // 60 seconds of inactivity
	}

	subscriber_manager = new SubscriberManager();
	watch_sub: Subscription | undefined = undefined;
	watch_filters = new Map<string, { filters: Filter[]; onMatch: (event: NostrEvent) => void }>();
	watch_refreshing = false;
	/**
	 * starts, stops or updates watch subscription based on filters from `this.watch_filters`
	 * @returns void
	 */
	async refreshWatch(
		since_now_minus = 1 // dont miss out on any event
	) {
		if (this.watch_refreshing) return;
		const since = unixNow() - since_now_minus;
		this.watch_refreshing = true; // prevent multiple instances of this method
		const closeIfEmpty = () => {
			if (this.watch_filters.size === 0) {
				this.watch_sub?.close();
				this.watch_sub = undefined;
				this.watch_refreshing = false;
				return true;
			}
			return false;
		};
		if (closeIfEmpty()) return;
		await this.connect();
		if (closeIfEmpty()) return;

		let watch_filters: Filter[] = [];
		this.watch_filters.forEach(({ filters }) => {
			watch_filters = [...watch_filters, ...filters.map((f) => ({ ...f, since }))];
		});
		this.watch_sub?.close();
		this.watch_sub = this.relay.subscribe(watch_filters, {
			onevent: (event) => {
				this.watch_filters.values().forEach(({ filters, onMatch }) => {
					if (matchFilters(filters, event)) onMatch(event);
				});
				this.onEvent(event);
			},
			onclose: (reason: string) => {
				if (reason.includes('rate')) {
					// wait a bit if rate limited
					setTimeout(() => {
						this.refreshWatch(6);
					}, 5000);
				} else {
					this.refreshWatch();
				}
			},
			eoseTimeout: 60 * 60 * 1000
		});
		this.watch_refreshing = false;
	}

	async publishEvent(event: NostrEvent) {
		return Promise.race([
			(async (): Promise<{ success: boolean; msg: string }> => {
				try {
					await this.connect();
					const msg = await this.relay.publish(event);
					this.processor.enqueueOutboxUpdate({
						id: event.id,
						relay: this.url,
						success: true,
						msg
					});
					return { success: true, msg };
				} catch (error) {
					const msg = `${error}`;
					if (msg.includes('duplicate')) {
						this.processor.enqueueOutboxUpdate({
							id: event.id,
							relay: this.url,
							success: true,
							msg
						});
						return { success: true, msg };
					}
					this.processor.enqueueOutboxUpdate({
						id: event.id,
						relay: this.url,
						success: false,
						msg: `${error}`
					});
					return { success: false, msg: `${error}` };
				}
			})(),
			new Promise<{ success: boolean; msg: string }>((r) => {
				setTimeout(() => {
					this.processor.enqueueOutboxUpdate({
						id: event.id,
						relay: this.url,
						success: false,
						msg: `timeout internal`
					});
					r({ success: false, msg: `timeout internal` });
				}, 30 * 1000);
			})
		]);
	}

	onEvent(event: NostrEvent) {
		if (IgnoreKinds.includes(event.kind)) return;
		addSeenRelay(event, this.url);
		this.processor.enqueueEvent(event);
		if (event.kind == RepoAnnKind) {
			const table = eventKindToTable(event.kind);
			if (table) {
				this.processor.enqueueRelayUpdate({
					type: 'found',
					uuid: getEventUID(event),
					kinds: [event.kind],
					created_at: event.created_at,
					table,
					url: this.url
				} as RelayUpdateRepoAnn);
			}
		} else if (event.kind === Metadata || event.kind === RelayList) {
			try {
				this.processor.enqueueRelayUpdate({
					type: 'found',
					uuid: getEventUID(event) as ARefR,
					kinds: [event.kind],
					created_at: event.created_at,
					table: 'pubkeys',
					url: this.url
				});
				this.fetch_pubkey_info_promises.resolvePromises(event.pubkey);
			} catch {
				/* empty */
			}
		} else if (event.kind === IssueKind || eventIsPrRoot(event)) {
			this.processor.enqueueRelayUpdate({
				type: 'found',
				uuid: event.id,
				kinds: [event.kind],
				table: event.kind === IssueKind ? 'issues' : 'prs',
				url: this.url
			});
		} else {
			// TODO patch kind where ? eventIsPrRoot()
			// TODO statuses
		}
	}

	async fetchAllRepos(pubkey?: PubKeyString) {
		const checks = await db.last_checks.get(`${this.url}|${pubkey}`);
		if (checks && checks.check_initiated_at && checks.check_initiated_at > Date.now() - 3000)
			return;
		db.last_checks.put({
			url_and_query: `${this.url}|${pubkey}`,
			url: this.url,
			check_initiated_at: Date.now(),
			timestamp: checks ? checks.timestamp : 0,
			// timestamp: unixNow(),
			query: pubkey ? pubkey : 'All Repos'
		});
		await this.connect();
		return new Promise<void>((r) => {
			const sub = this.relay.subscribe(
				[
					{
						kinds: [RepoAnnKind],
						since: !pubkey && checks ? Math.round(checks.timestamp - 60 * 10) : 0
						// TODO: what if this last check failed to reach the relay?
						// limit: 100,
						// TODO request next batch if 100 recieved
					}
				],
				{
					onevent: (event) => this.onEvent(event),
					oneose: async () => {
						sub.close();
						this.resetInactivityTimer();
						db.last_checks.put({
							url_and_query: `${this.url}|${pubkey}`,
							url: this.url,
							check_initiated_at: undefined,
							timestamp: unixNow(),
							query: pubkey ? pubkey : 'All Repos'
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
					this.onEvent(event);
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
								kinds: [Metadata],
								table: 'pubkeys',
								url: this.url
							});
						} else {
							if (!found_metadata.has(pubkey)) {
								this.processor.enqueueRelayUpdate({
									type: 'not-found',
									uuid: `${Metadata}:${pubkey}` as ARefR,
									kinds: [Metadata],
									table: 'pubkeys',
									url: this.url
								});
							}
							if (!found_metadata.has(pubkey)) {
								this.processor.enqueueRelayUpdate({
									type: 'not-found',
									uuid: `${RelayList}:${pubkey}` as ARefR,
									kinds: [RelayList],
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

	async fetchPubkeyNotifications(pubkey: PubKeyString, since: number) {
		await this.connect();
		const sub = this.relay.subscribe([...createPubkeyNoficiationsFilters(pubkey, since)], {
			onevent: (event) => this.onEvent(event)
		});
		return async () => {
			return sub.close();
		};
	}

	repo_queue: Map<RepoRef, RelayCheckTimestamp> = new Map();
	set_repo_queue_timeout: ReturnType<typeof setTimeout> | undefined = undefined;
	fetch_repo_promises = new PromiseManager<RepoRef, () => void>();

	async fetchRepo(
		a_ref: RepoRef,
		check_timestamp: RelayCheckTimestamp,
		level: RepoCheckLevel = 'children'
	) {
		// children is also getting children statuses
		if (level === 'quality_grandchildren') {
			console.log('TODO: handle quality_grandchildren');
		}
		if (!this.repo_queue.has(a_ref)) {
			this.repo_queue.set(a_ref, check_timestamp);
			await this.connect();
			if (!this.set_repo_queue_timeout) {
				this.set_repo_queue_timeout = setTimeout(async () => {
					this.fetchRepoQueue();
				}, 200);
			}
		}
		return this.fetch_repo_promises.addPromise(a_ref, 20 * 1000);
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
		const original_a_refs_with_timestamps = new Map(this.repo_queue);
		this.repo_queue.clear();

		const searched_a_refs = new Set<RepoRef>([...original_a_refs_with_timestamps.keys()]);
		const unsearched_a_refs = new Set<RepoRef>();
		let last_a_refs_searched = new Set<RepoRef>();
		const repo_ann_received = new Set<RepoRef>();
		const searched_issues_and_pr_roots = new Set<EventIdString>();
		const unsearched_issues_and_pr_roots = new Set<EventIdString>();

		const markAsSearched = () => {
			last_a_refs_searched = new Set([...searched_a_refs]);
			unsearched_a_refs.forEach((e) => searched_a_refs.add(e));
			unsearched_a_refs.clear();
			unsearched_issues_and_pr_roots.forEach((e) => searched_issues_and_pr_roots.add(e));
			unsearched_issues_and_pr_roots.clear();
		};
		const addUnsearchedIssuesAndPrsFromRepoItem = (repo_item: RepoTableItem) => {
			getIssuesAndPrsIdsFromRepoItem(repo_item).forEach((id) => {
				if (!searched_issues_and_pr_roots.has(id)) unsearched_issues_and_pr_roots.add(id);
			});
		};

		clearTimeout(this.set_repo_queue_timeout);
		this.set_repo_queue_timeout = undefined;
		// add all repos with same identifier to queue
		(
			await db.repos
				.where('identifier')
				.anyOf([...new Set<RepoRef>([...original_a_refs_with_timestamps.keys()])])
				.toArray()
		).forEach((record) => {
			original_a_refs_with_timestamps.set(
				record.uuid,
				repoTableItemToRelayCheckTimestamp(record, this.url)
			);
			addUnsearchedIssuesAndPrsFromRepoItem(record);
		});

		let filters = [
			...createRepoIdentifierFilters(original_a_refs_with_timestamps),
			...createRepoChildrenFilters(original_a_refs_with_timestamps),
			...createRepoChildrenStatusAndDeletionFilters(
				unsearched_issues_and_pr_roots,
				original_a_refs_with_timestamps
			),
			...createRepoChildrenQualityFilters(
				unsearched_issues_and_pr_roots,
				original_a_refs_with_timestamps
			)
		];
		markAsSearched();

		let count = 0;
		let last_filters = '';
		const nextPageNeeded = () => count > 90 && last_filters !== JSON.stringify(filters);

		const onevent = (event: NostrEvent) => {
			// paging
			count++;
			filters.forEach((f: Filter) => {
				if (matchFilters([f], event) && event.created_at < (f.until ?? unixNow()))
					f.until = event.created_at + 1;
			});

			this.onEvent(event);
			if (event.kind === RepoAnnKind) {
				const a_ref = getEventUID(event) as RepoRef;
				if (!searched_a_refs.has(a_ref)) unsearched_a_refs.add(a_ref);
				repo_ann_received.add(a_ref);
			} else if (event.kind === IssueKind || eventIsPrRoot(event)) {
				getRepoRefs(event).forEach((a_ref) => {
					if (!searched_a_refs.has(a_ref)) unsearched_a_refs.add(a_ref);
				});
				if (!searched_issues_and_pr_roots.has(event.id))
					unsearched_issues_and_pr_roots.add(event.id);
			}
		};
		const onEoseRecursivelyGetDisoveredARefResults = async (sub: Subscription) => {
			sub.close();
			this.resetInactivityTimer();
			for (const a_ref of last_a_refs_searched) {
				this.processor.enqueueRelayUpdate({
					type: 'checked',
					uuid: a_ref,
					table: 'repos',
					kinds: [PatchKind, IssueKind],
					url: this.url
				} as RelayUpdateRepoChildren);
				const filtered_for_a_ref_without_since = filters.some(
					(f) =>
						'#d' in f &&
						f['#d'] &&
						f['#d'].includes(aRefPToAddressPointer(a_ref).identifier) &&
						!f.since &&
						f.kinds?.includes(RepoAnnKind)
				);

				if (filtered_for_a_ref_without_since && !repo_ann_received.has(a_ref)) {
					this.processor.enqueueRelayUpdate({
						type: 'not-found',
						uuid: a_ref,
						kinds: [RepoAnnKind],
						table: 'repos',
						url: this.url
					} as RelayUpdateRepoAnn);
				} else {
					this.processor.enqueueRelayUpdate({
						type: repo_ann_received.has(a_ref) ? 'found' : 'checked',
						uuid: a_ref,
						kinds: [RepoAnnKind],
						table: 'repos',
						url: this.url
					} as RelayUpdateRepoAnn);
				}
			}

			while (unsearched_a_refs.size > 0 || unsearched_issues_and_pr_roots.size > 0) {
				if (unsearched_a_refs.size > 0) {
					(
						await db.repos
							.where('identifier')
							.anyOf([...unsearched_a_refs])
							.toArray()
					).forEach((record) => {
						addUnsearchedIssuesAndPrsFromRepoItem(record);
					});
				}
				await new Promise<void>((r) => {
					filters = [
						...createRepoIdentifierFilters(unsearched_a_refs),
						...createRepoChildrenFilters(unsearched_a_refs),
						...createRepoChildrenStatusAndDeletionFilters(unsearched_issues_and_pr_roots),
						...createRepoChildrenQualityFilters(unsearched_issues_and_pr_roots)
					];
					markAsSearched();
					const runWithPaging = () => {
						last_filters = JSON.stringify(filters);
						count = 0;
						const sub = this.relay.subscribe(filters, {
							onevent: (event) => onevent(event),
							oneose: () => {
								if (nextPageNeeded()) {
									sub.close();
									runWithPaging();
									return;
								}
								onEoseRecursivelyGetDisoveredARefResults(sub);
								r();
							}
						});
					};
					runWithPaging();
				});
			}
		};

		const runWithPaging = () => {
			last_filters = JSON.stringify(filters);
			count = 0;
			const sub = this.relay.subscribe(filters, {
				onevent: (event) => onevent(event),
				oneose: async () => {
					if (nextPageNeeded()) {
						// paging
						sub.close();
						runWithPaging();
						return;
					}
					await onEoseRecursivelyGetDisoveredARefResults(sub);
					this.fetching_repo_queue = false;
					searched_a_refs.forEach((a_ref) => {
						const unsubsriber = this.watchRepo(a_ref, {
							a_tags: [...searched_a_refs],
							e_tags: [...searched_issues_and_pr_roots]
						});
						this.fetch_repo_promises.resolvePromises(a_ref, unsubsriber);
					});
				}
			});
		};
		runWithPaging();
	}

	watching_a_refs = new Map<RepoRef, { a_tags: (ARefR | ARefP)[]; e_tags: EventIdString[] }>();

	watchRepo(a_ref: RepoRef, events?: { a_tags: (ARefR | ARefP)[]; e_tags: EventIdString[] }) {
		const query = `watchRepos${a_ref}`;
		this.subscriber_manager.add(query);
		this.connect().then(() => {
			this.updateReposWatch(a_ref, events);
		});
		const interval_id = setInterval(() => this.resetInactivityTimer(), 50000);

		const unsubriber = () => {
			clearInterval(interval_id);
			if (this.subscriber_manager.remove(query)) {
				this.removeRepoWatcher(a_ref);
			}
		};
		this.subscriber_manager.addUnsubsriber(query, unsubriber);

		return unsubriber;
	}

	removeRepoWatcher(a_ref: RepoRef) {
		if (this.subscriber_manager.remove(`watchRepos${a_ref}`)) {
			this.watching_a_refs.delete(a_ref);
			if (this.watching_a_refs.size === 0) {
				this.watch_filters.delete('repos');
				this.refreshWatch();
			}
		}

		if (this.watching_a_refs.size === 0) {
			this.watch_sub?.close();
		} else {
			// no need to refresh the subscrition without the a_ref, its doing no harm
		}
	}

	/**
	 * update events to watch related to a RepoRef we are watching
	 * @param a_ref RepoRef of the repository we are currently watching
	 * @param events additional event tags to watch related to the repo
	 */
	updateReposWatch(
		a_ref: RepoRef,
		events?: { a_tags: (ARefR | ARefP)[]; e_tags: EventIdString[] }
	) {
		const query_a_tags = new Set<ARefR | ARefP>();
		const query_e_tags = new Set<EventIdString>();

		this.watching_a_refs.forEach(({ a_tags, e_tags }) => {
			a_tags.forEach((tag) => query_a_tags.add(tag));
			e_tags.forEach((tag) => query_e_tags.add(tag));
		});

		let change = false;

		[a_ref, ...(events?.a_tags ?? [])].forEach((t) => {
			if (!change && !query_a_tags.has(t)) change = true;
			query_a_tags.add(t);
		});

		(events?.e_tags ?? []).forEach((t) => {
			if (!change && !query_e_tags.has(t)) change = true;
			query_e_tags.add(t);
		});

		if (change) {
			this.watch_filters.set('repos', {
				onMatch: (event) => {
					this.updateReposWatch(a_ref, { a_tags: [a_ref], e_tags: [event.id] });
				},
				filters: [
					{
						'#a': query_a_tags.size == 0 ? undefined : [...query_a_tags],
						since: unixNow()
					},

					{
						'#e': query_e_tags.size == 0 ? undefined : [...query_e_tags],
						since: unixNow()
					},
					{
						// children kinds but for all repos on relay
						kinds: [...(createRepoChildrenFilters(new Set([]))[0]?.kinds ?? [])],
						since: unixNow()
					}
				]
			});
			this.refreshWatch();
		}
	}

	async fetchThread(
		id: EventIdString,
		known_replies: EventIdString[] = []
	): Promise<EventIdString[]> {
		await this.connect();
		return await new Promise((r) => {
			let ids_searched: EventIdString[] = [];
			let ids_to_find: EventIdString[] = [id, ...known_replies];
			let sub: Subscription;
			let searched_root = false;
			const onevent = (event: NostrEvent) => {
				this.onEvent(event);
				const kinds_not_to_request_replys_for = [Reaction];
				if (!kinds_not_to_request_replys_for.includes(event.kind)) ids_to_find.push(event.id);
			};
			const onEose = (sub: Subscription) => {
				sub.close();
				findNext();
			};
			const findNext = () => {
				this.resetInactivityTimer();
				ids_searched = [...ids_searched, ...ids_to_find];
				// TODO get from other relays via db.issues.get(id)
				if (ids_to_find.length === 0) r(ids_searched);
				else {
					sub = this.relay.subscribe(
						[{ '#e': [...ids_to_find] }, ...(searched_root ? [] : [{ '#E': [id] }])],
						{
							onevent: (event) => onevent(event),
							oneose: () => {
								onEose(sub);
							}
						}
					);
					ids_to_find = [];
					searched_root = true;
				}
			};
			findNext();
		});
	}

	async watchThread(id: EventIdString, known_replies: EventIdString[] = []) {
		const query = `watchThread${id}`;
		const is_new = this.subscriber_manager.add(query);
		if (is_new) {
			const know_ids = await this.fetchThread(id, known_replies);
			// if not unsubscribed during fetchThread
			if (this.subscriber_manager.has(query)) {
				// update the filter when replies recieved to look for their replies
				const onMatch = (event: NostrEvent) => {
					if (!know_ids.includes(event.id)) {
						know_ids.push(event.id);
						this.watch_filters.set(query, {
							onMatch,
							filters: [{ '#e': [id, ...know_ids] }, { '#E': [id] }]
						});
						this.refreshWatch();
					}
				};
				this.watch_filters.set(query, {
					onMatch,
					filters: [{ '#e': [id, ...know_ids] }, { '#E': [id] }]
				});
				this.refreshWatch();
				this.subscriber_manager.addUnsubsriber(query, () => {
					this.watch_filters.delete(query);
					this.refreshWatch();
				});
			}
		}
		return () => this.subscriber_manager.remove(query);
	}

	async fetchEvent(
		event_ref: NEventAttributes | EventPointer,
		and_children: boolean = false
	): Promise<NostrEvent | undefined> {
		await this.connect();
		return await new Promise<NostrEvent | undefined>((r) => {
			const sub = this.relay.subscribe(
				[
					{ ids: [event_ref.id] },
					...(and_children
						? ([{ '#E': [event_ref.id] }, { '#e': [event_ref.id] }] as Filter[])
						: [])
				],
				{
					onevent: async (event) => {
						this.onEvent(event);
						if (event.id !== event_ref.id) return;
						r(event);
					},
					oneose: () => {
						sub.close();
						r(undefined);
					}
				}
			);
		});
	}

	async fetchRecentActions(a_ref: RepoRef): Promise<void> {
		await this.connect();
		await new Promise<void>((r) => {
			const sub = this.relay.subscribe(
				[
					...createRecentActionsRequestFilter(a_ref),
					...createRecentActionsResultFilter(a_ref),
					...createActionDVMProvidersFilter()
				],
				{
					onevent: async (event) => {
						this.onEvent(event);
					},
					oneose: () => {
						sub.close();
						r(undefined);
					}
				}
			);
		});
	}

	watchActions(a_ref: RepoRef): () => void {
		const query = `watchActions${a_ref}`;
		const is_new = this.subscriber_manager.add(query);
		if (is_new) {
			this.watch_filters.set(query, {
				onMatch: () => {},
				filters: [...createWatchActionsFilter(a_ref), ...createActionDVMProvidersFilter()]
			});
			this.refreshWatch();
			this.subscriber_manager.addUnsubsriber(query, () => {
				this.watch_filters.delete(query);
				this.refreshWatch();
			});
		}
		return () => this.subscriber_manager.remove(query);
	}

	async fetchWallet(pubkey: PubKeyString): Promise<void> {
		await this.connect();
		await new Promise<void>((r) => {
			const sub = this.relay.subscribe(
				[...createWalletFilter(pubkey), ...createWalletHistoryFilter(pubkey)],
				{
					onevent: async (event) => {
						this.onEvent(event);
					},
					oneose: () => {
						sub.close();
						r(undefined);
					}
				}
			);
		});
	}

	watchWallet(pubkey: PubKeyString): () => void {
		const query = `watchWallet${pubkey}`;
		const is_new = this.subscriber_manager.add(query);
		this.fetchWallet(pubkey).then(() => {
			if (is_new) {
				this.watch_filters.set(query, {
					onMatch: () => {},
					filters: [...createWalletFilter(pubkey), ...createWalletHistoryFilter(pubkey)]
				});
				this.refreshWatch();
				this.subscriber_manager.addUnsubsriber(query, () => {
					this.watch_filters.delete(query);
					this.refreshWatch();
				});
			}
		});
		return () => this.subscriber_manager.remove(query);
	}
}

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
