import {
	action_dvm_relays,
	base_relays,
	chooseBaseRelays,
	chooseRelaysForAllRepos,
	chooseRelaysForPubkey,
	chooseRelaysForRepo,
	getPubkeyInboxRelays,
	getPubkeyOutboxRelays,
	getRepoInboxRelays
} from '$lib/relay/RelaySelection';
import { RelayManager } from '$lib/relay/RelayManager';
import {
	isWebSocketUrl,
	type ARefP,
	type EventIdString,
	type Nip05AddressStandardized,
	type OutboxItem,
	type OutboxRelayLog,
	type PubKeyString,
	type PubKeyTableItem,
	type RepoRef,
	type RepoTableItem,
	type WebSocketUrl
} from '$lib/types';
import { unixNow } from 'applesauce-core/helpers';
import { addEventsToCache, getCacheEventsForFilters } from '$lib/dbs/LocalRelayDb';
import { action_dvm_kind, repo_kind } from '$lib/kinds';
import { nip05 as nip05NostrTools, type Filter, type NostrEvent } from 'nostr-tools';
import { Metadata, RelayList } from 'nostr-tools/kinds';
import Processor from '$lib/processors/Processor';
import db from '$lib/dbs/LocalDb';
import { aRefPToAddressPointer } from '$lib/utils';
import { createFetchActionsFilter } from '$lib/relay/filters/actions';
import type { NEventAttributes } from 'nostr-editor';
import SubscriberManager from '$lib/SubscriberManager';
import {
	createRepoChildrenFilters,
	createRepoIdentifierFilters,
	createRepoChildrenStatusFilters
} from '$lib/relay/filters';
import { getIssuesAndPrsIdsFromRepoItem } from '$lib/repos';
import type { EventPointer } from 'nostr-tools/nip19';

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
			return cached;
		}
		return [];
	}

	async publishEvent(event: NostrEvent) {
		addEventsToCache([event]);
		this.processor.enqueueEvent(event);
		const [item, users, repos] = await Promise.all([
			(async (): Promise<OutboxItem> => {
				let item = await db.outbox.get(event.id);
				if (!item) {
					item = {
						id: event.id,
						event,
						broadly_sent: false,
						relay_logs: []
					};
					db.outbox.add(item, event.id);
				}
				return item;
			})(),
			(async (): Promise<PubKeyTableItem[]> => {
				const pubkeys = event.tags.filter((t) => t[1] && t[0] === 'p').map((t) => t[1]);
				return (await db.pubkeys.bulkGet([event.pubkey, ...pubkeys])).filter((p) => !!p);
			})(),
			(async (): Promise<RepoTableItem[]> => {
				const a_refs = event.tags
					.filter((t) => t[1] && t[0] === 'a' && t[1].startsWith(`${repo_kind}`))
					.map((t) => t[1]) as RepoRef[];
				// Note: here we are just ignoring repos that we don't have a record for so we wont send to their relays
				return (await db.repos.bulkGet(a_refs)).filter((a_ref) => !!a_ref);
			})()
		]);
		const relay_logs = new Map<WebSocketUrl, OutboxRelayLog>();
		// note as we are providing a table item, this will probably wont be async
		if (event.kind !== action_dvm_kind)
			await Promise.all([
				...users.map((u) =>
					(async (): Promise<void> => {
						const pubkey_relays =
							u.pubkey === event.pubkey
								? await getPubkeyOutboxRelays(u)
								: await getPubkeyInboxRelays(u);
						pubkey_relays.forEach((r) => {
							let log = relay_logs.get(r);
							if (!log) {
								log = { url: r, success: false, groups: [], attempts: [] };
								relay_logs.set(r, log);
							}
							log.groups.push(u.pubkey);
						});
					})()
				),
				...repos.map((repo) =>
					(async (): Promise<void> => {
						const repo_relays = await getRepoInboxRelays(repo);
						repo_relays.forEach((r) => {
							let log = relay_logs.get(r);
							if (!log) {
								log = { url: r, success: false, groups: [], attempts: [] };
								relay_logs.set(r, log);
							}
							log.groups.push(repo.uuid);
						});
					})()
				)
			]);

		if (event.kind === action_dvm_kind) {
			action_dvm_relays.forEach((r) => {
				let log = relay_logs.get(r);
				if (!log) {
					log = { url: r, success: false, groups: [], attempts: [] };
					relay_logs.set(r, log);
				}
				log.groups.push('Action DVM');
			});
		}
		await db.outbox.put({ ...item, relay_logs: [...relay_logs.values()] });

		relay_logs.forEach(async (log) => {
			if (!log.success) {
				const attempt = async () => {
					const res = await this.get_relay(log.url).publishEvent(event);
					if (!res.success && (res.msg.indexOf('rate') > 0 || res.msg.indexOf('timeout') > 0)) {
						setTimeout(attempt, 65 * 1000);
					}
				};
				attempt();
			}
		});
		// TODO when we do a browser refresh, how are pending sends processed?
	}

	async fetchAllRepos() {
		await this.hydrate_from_cache_db([{ kinds: [repo_kind] }]);
		const relays = await chooseRelaysForAllRepos();
		await Promise.all(relays.map((url) => this.get_relay(url).fetchAllRepos()));
	}

	subscriber_manager = new SubscriberManager();

	async fetchRepo(a_ref: ARefP) {
		const pointer = aRefPToAddressPointer(a_ref);
		if (!pointer) return;
		const query = `fetchRepo${a_ref}`;
		const already_fetching = !this.subscriber_manager.add(query);
		if (already_fetching) return;
		let record = await db.repos.get(a_ref);
		await this.hydrate_from_cache_db([
			...createRepoIdentifierFilters(new Set([a_ref])),
			...createRepoChildrenFilters(new Set([a_ref])),
			...(record ? createRepoChildrenStatusFilters(getIssuesAndPrsIdsFromRepoItem(record)) : [])
		]);
		const relays_tried: WebSocketUrl[] = [];
		let new_repo_relays_found = false;
		// only loop if repo announcement not found
		let count = 0;
		while (count === 0 || !record || !record.created_at || new_repo_relays_found) {
			count++;
			const relays = await chooseRelaysForRepo(record ? record : a_ref, relays_tried);
			if (relays.length === 0) {
				// TODO lookup all other relays known by LocalDb and try those
				break;
			}
			relays.forEach(({ url }) => relays_tried.push(url));
			try {
				await Promise.all(
					relays.map(({ url, check_timestamps }) =>
						(async () => {
							const unsubsriber = await this.get_relay(url).fetchRepo(a_ref, check_timestamps);
							this.subscriber_manager.addUnsubsriber(query, unsubsriber);
						})()
					)
				);
			} catch {
				/* empty */
			}
			record = await db.repos.get(a_ref);
			new_repo_relays_found =
				record?.relays?.some((r) => isWebSocketUrl(r) && !relays_tried.includes(r)) ?? false;
		}
		return;
	}

	fetchRepoUnsubscribe(a_ref: ARefP) {
		this.subscriber_manager.remove(`fetchRepo${a_ref}`);
	}

	async fetchPubkeyRepos(pubkey: PubKeyString) {
		await this.hydrate_from_cache_db([{ kinds: [repo_kind], authors: [pubkey] }]);
		const relays = await chooseRelaysForPubkey(pubkey);
		await Promise.all(relays.map(({ url }) => this.get_relay(url).fetchAllRepos(pubkey)));
	}

	async fetchIssueThread(a_ref: RepoRef, id: EventIdString) {
		const table_item = await db.issues.get(id);
		const ids: EventIdString[] = [];
		if (table_item) {
			// TODO get know child events to also search for
		}
		await this.hydrate_from_cache_db([{ '#e': [id, ...ids] }]);
		// TODO create chooseRelaysForIssue, that uses the Repo scoring but its own last checked
		const relays = await chooseRelaysForRepo(a_ref);
		try {
			await Promise.all(relays.map(({ url }) => this.get_relay(url).fetchThread(a_ref, id, ids)));
		} catch {
			/* empty */
		}
	}

	async fetchPrThread(a_ref: RepoRef, id: EventIdString) {
		const table_item = await db.prs.get(id);
		const ids: EventIdString[] = [];
		if (table_item) {
			// TODO get know child events to also search for
		}
		await this.hydrate_from_cache_db([{ '#e': [id, ...ids] }]);
		// TODO create chooseRelaysForPr, that uses the Repo scoring but its own last checked
		const relays = await chooseRelaysForRepo(a_ref);
		try {
			await Promise.all(relays.map(({ url }) => this.get_relay(url).fetchThread(a_ref, id, ids)));
		} catch {
			/* empty */
		}
	}

	async fetchEvent(event_ref: NEventAttributes | EventPointer) {
		const cached = await this.hydrate_from_cache_db([{ ids: [event_ref.id] }]);
		if (cached.length > 0) return;
		let tried: WebSocketUrl[] = [];
		const relays = (event_ref.relays ?? []).filter((r) => isWebSocketUrl(r));
		if (relays.length > 0) {
			tried = [...tried, ...relays];
			const res = await Promise.all(relays.map((url) => this.get_relay(url).fetchEvent(event_ref)));
			if (res.some((e) => e?.id === event_ref.id)) return;
		}

		if (event_ref.author) {
			const user_relays = (await chooseRelaysForPubkey(event_ref.author)).filter(
				({ url }) => !tried.includes(url)
			);
			if (user_relays.length > 0) {
				const res = await Promise.all(
					user_relays.map(({ url }) => {
						tried.push(url);
						return this.get_relay(url).fetchEvent(event_ref);
					})
				);
				if (res.some((e) => e?.id === event_ref.id)) return;
			}
		}

		const other_relays = chooseBaseRelays().filter((url) => !tried.includes(url));
		if (other_relays.length > 0) {
			const res = await Promise.all(
				other_relays.map((url) => {
					tried.push(url);
					return this.get_relay(url).fetchEvent(event_ref);
				})
			);
			if (res.some((e) => e?.id === event_ref.id)) return;
		}

		return tried;
	}

	async fetchPubkeyName(pubkey: PubKeyString) {
		await this.hydrate_from_cache_db([{ kinds: [Metadata, RelayList], authors: [pubkey] }]);
		const record = await db.pubkeys.get(pubkey);
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
		}
	}

	async fetchNip05(nip05: Nip05AddressStandardized) {
		const pointer = await nip05NostrTools.queryProfile(nip05);
		if (pointer) {
			this.processor.enqueueNip05(nip05, pointer.pubkey, pointer.relays);
			this.fetchPubkeyName(pointer.pubkey);
		}
		return pointer?.pubkey ?? undefined;
	}

	listenForActions(a_ref: RepoRef) {
		const query = `listenForActions${a_ref}`;
		if (this.subscriber_manager.add(query)) {
			action_dvm_relays.forEach((url) => {
				this.subscriber_manager.addUnsubsriber(query, this.get_relay(url).listenForActions(a_ref));
			});
		}
	}

	stopListeningForActions(a_ref: RepoRef) {
		this.subscriber_manager.remove(`listenForActions${a_ref}`);
	}

	async fetchActions(a_ref: RepoRef) {
		await this.hydrate_from_cache_db(createFetchActionsFilter(a_ref));
		const relays = await chooseRelaysForRepo(a_ref);
		try {
			await Promise.all(relays.map(({ url }) => this.get_relay(url).fetchActions(a_ref)));
		} catch {
			/* empty */
		}
	}
}

const external = new QueryCentreExternal();

self.onmessage = async (event) => {
	const { method, args, request_identifier } = event.data;
	let result;
	switch (method) {
		case 'publishEvent':
			result = await external.publishEvent(args[0]);
			break;
		case 'fetchAllRepos':
			result = await external.fetchAllRepos();
			break;
		case 'fetchRepo':
			result = await external.fetchRepo(args[0]);
			break;
		case 'fetchRepoUnsubscribe':
			result = await external.fetchRepoUnsubscribe(args[0]);
			break;
		case 'fetchPubkeyRepos':
			result = await external.fetchPubkeyRepos(args[0]);
			break;
		case 'fetchIssueThread':
			result = await external.fetchIssueThread(args[0], args[1]);
			break;
		case 'fetchPrThread':
			result = await external.fetchPrThread(args[0], args[1]);
			break;

		case 'fetchEvent':
			result = await external.fetchEvent(args[0]);
			break;

		case 'fetchPubkeyName':
			result = await external.fetchPubkeyName(args[0]);
			break;
		case 'fetchNip05':
			result = await external.fetchNip05(args[0]);
			break;
		case 'fetchActions':
			result = await external.fetchActions(args[0]);
			break;
		case 'listenForActions':
			result = await external.listenForActions(args[0]);
			break;
		case 'stopListeningForActions':
			result = await external.stopListeningForActions(args[0]);
			break;
		default:
			console.error('Unknown method:', method);
			break;
	}

	self.postMessage({ request_identifier, result });
};
