import {
	chooseRelaysForAllRepos,
	chooseRelaysForPubkey,
	chooseRelaysForRepo
} from '$lib/relay/RelaySelection';
import { RelayManager } from '$lib/relay/RelayManager';
import type {
	ARefP,
	AtLeastThreeArray,
	Nip05AddressStandardized,
	PubKeyString,
	RepoRef,
	WebSocketUrl
} from '$lib/types';
import { unixNow } from 'applesauce-core/helpers';
import { getCacheEventsForFilters } from '$lib/dbs/LocalRelayDb';
import { issue_kind, patch_kind, proposal_status_kinds, repo_kind } from '$lib/kinds';
import { nip05 as nip05NostrTools, type Filter } from 'nostr-tools';
import { Metadata, RelayList } from 'nostr-tools/kinds';
import Processor from '$lib/processors/Processor';
import db from '$lib/dbs/LocalDb';
import { aRefPToAddressPointer } from '$lib/utils';
import {
	workerMessageFetchedNip05,
	workerMessageFetchedPubkey,
	workerMessageFetchedRepo
} from '$lib/types/worker-msgs';
import { createFetchActionsFilter } from '$lib/relay/filters/actions';

export const base_relays: AtLeastThreeArray<WebSocketUrl> = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band',
	'wss://relay.primal.net'
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

	async fetchRepo(a_ref: ARefP) {
		const pointer = aRefPToAddressPointer(a_ref);
		if (!pointer) return;
		await this.hydrate_from_cache_db([
			{
				kinds: [repo_kind],
				'#d': [pointer.identifier]
			},
			{
				kinds: [issue_kind, patch_kind, ...proposal_status_kinds],
				'#a': [pointer.identifier]
			}
		]);
		let record = await db.repos.get(a_ref);
		const relays_tried: WebSocketUrl[] = [];
		// only loop if repo announcement not found
		let count = 0;
		while (count === 0 || !record || !record.created_at) {
			count++;
			const relays = (await chooseRelaysForRepo(a_ref))
				.filter(
					({ url, check_timestamps }) =>
						// skip relays just tried
						!relays_tried.includes(url) &&
						// and relays checked within 30 seconds
						(!check_timestamps.last_check || check_timestamps.last_check < unixNow() - 30)
				)
				// try repo relays + 3 others limited to 6 at each try
				.slice(0, Math.min((record && record.relays ? record.relays.length : 0) + 3, 6));
			if (relays.length === 0) {
				// TODO lookup all other relays known by LocalDb and try those
				break;
			}
			relays.forEach(({ url }) => relays_tried.push(url));
			try {
				await Promise.all(
					relays.map(({ url, check_timestamps }) =>
						this.get_relay(url).fetchRepo(a_ref, check_timestamps)
					)
				);
			} catch {
				/* empty */
			}
			record = await db.repos.get(a_ref);
		}
		self.postMessage(workerMessageFetchedRepo(a_ref));
	}

	async fetchPubkeyRepos(pubkey: PubKeyString) {
		await this.hydrate_from_cache_db([{ kinds: [repo_kind], authors: [pubkey] }]);
		const relays = await chooseRelaysForPubkey(pubkey);
		await Promise.all(relays.map(({ url }) => this.get_relay(url).fetchAllRepos(pubkey)));
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
		self.postMessage(workerMessageFetchedPubkey(pubkey));
		return record;
	}

	async fetchNip05(nip05: Nip05AddressStandardized) {
		const pointer = await nip05NostrTools.queryProfile(nip05);
		if (pointer) {
			this.processor.enqueueNip05(nip05, pointer.pubkey, pointer.relays);
			await this.fetchPubkeyName(pointer.pubkey);
		}
		self.postMessage(workerMessageFetchedNip05(nip05));
	}

	async fetchActions(a_ref: RepoRef) {
		await this.hydrate_from_cache_db(createFetchActionsFilter(a_ref));
		const relays = (await chooseRelaysForRepo(a_ref)).slice(0, 6);
		try {
			await Promise.all(relays.map(({ url }) => this.get_relay(url).fetchActions(a_ref)));
		} catch {
			/* empty */
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
		case 'fetchRepo':
			result = await external.fetchRepo(args[0]);
			break;
		case 'fetchPubkeyRepos':
			result = await external.fetchPubkeyRepos(args[0]);
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
		default:
			console.error('Unknown method:', method);
			break;
	}

	self.postMessage(result);
};
