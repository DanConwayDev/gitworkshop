import { liveQuery } from 'dexie';
import { nip19, type Filter, type NostrEvent } from 'nostr-tools';
import { memory_db_query_store } from './dbs/InMemoryRelay';
import type { NEventAttributes } from 'nostr-editor';
import {
	type Nip05Address,
	type Npub,
	type PubKeyString,
	type RepoRef,
	type RepoRouteNip05String,
	type RepoRouteString,
	type RepoTableItem,
	type WebSocketUrl
} from './types';
import { aRefPToAddressPointer, aToNaddr, repoRefToPubkeyLink } from './utils';
import store from './store.svelte';
import { repoToRepoRef } from './repos';
import query_centre from './query-centre/QueryCentre.svelte';

/// this is taken and adapted from https://github.com/dexie/Dexie.js/pull/2116
/// when merged the version from the library should be used

export function liveQueryState<T>(querier: () => T | Promise<T>, dependencies?: () => unknown[]) {
	const query = $state<{ current?: T; isLoading: boolean; error?: unknown }>({
		current: undefined,
		isLoading: true,
		error: undefined
	});
	$effect(() => {
		dependencies?.();
		query.isLoading = true;
		return liveQuery(querier).subscribe(
			(result) => {
				query.isLoading = false;
				query.error = undefined;
				query.current = result;
			},
			(error) => {
				query.error = error;
				query.isLoading = false;
			}
		).unsubscribe;
	});
	return query;
}

export function inMemoryRelayTimeline(filters: Filter[], dependencies?: () => unknown[]) {
	const result = $state<{ timeline: NostrEvent[] }>({ timeline: [] });
	$effect(() => {
		dependencies?.();
		const sub = memory_db_query_store.timeline(filters).subscribe((events) => {
			result.timeline = [...events];
		});
		return () => {
			sub.unsubscribe();
		};
	});
	return result;
}

export function inMemoryRelayEvent(event_ref: NEventAttributes, dependencies?: () => unknown[]) {
	const result = $state<{ event: NostrEvent | undefined }>({ event: undefined });
	$effect(() => {
		dependencies?.();
		const sub = memory_db_query_store.event(event_ref.id).subscribe((event) => {
			result.event = event;
		});
		return () => {
			sub.unsubscribe();
		};
	});
	return result;
}

export class RepoRouteStringCreator {
	private table_item: RepoTableItem | undefined = $state(undefined);
	private a_ref: RepoRef | undefined = $state(undefined);
	private explicit_relay: WebSocketUrl | undefined = $state(undefined);

	private relays = $derived(
		this.explicit_relay ? [this.explicit_relay] : firstRelay(this.table_item?.relays)
	);
	private pointer = $derived(
		this.a_ref ? aRefPToAddressPointer(this.a_ref, this.relays) : undefined
	);

	private nip_creator = $derived(
		this.pointer && store.url_pref === 'nip05'
			? new UserRouteStringCreator(this.pointer.pubkey)
			: undefined
	);

	s: RepoRouteString | undefined = $derived.by(() => {
		if (this.pointer && this.a_ref) {
			if (store.url_pref === 'naddr') return aToNaddr(this.pointer);
			else if (store.url_pref === 'nip05' && this.nip_creator?.s) {
				return `${this.nip_creator.s}/${this.pointer.identifier}` as RepoRouteNip05String;
			} else return repoRefToPubkeyLink(this.a_ref);
		}
		return undefined;
	});

	constructor(a_ref_or_table_item: RepoRef | RepoTableItem, relay?: WebSocketUrl) {
		const is_a_ref = typeof a_ref_or_table_item == 'string';
		this.a_ref = is_a_ref ? a_ref_or_table_item : repoToRepoRef(a_ref_or_table_item);
		this.explicit_relay = relay;
	}
}
const firstRelay = (relays: string[] = []) => (!relays[0] ? [] : [relays[0]]);

export class UserRouteStringCreator {
	private pubkey: PubKeyString | undefined = $state(undefined);

	private profile_query = $derived(
		this.pubkey && store.url_pref === 'nip05'
			? query_centre.fetchPubkeyName(this.pubkey)
			: undefined
	);
	private nip05_query = $derived.by(() => {
		if (this.profile_query?.current?.metadata.fields.nip05) {
			return query_centre.fetchNip05(
				this.profile_query.current?.metadata.fields.nip05 as Nip05Address
			);
		} else return undefined;
	});

	private nip05: Nip05Address | undefined = $derived.by(() => {
		const profile = this.nip05_query?.current?.user;
		if (!profile) return undefined;
		if (profile.pubkey == this.pubkey && profile.verified_nip05[0]) {
			return profile.verified_nip05[0].slice(
				profile.verified_nip05[0].startsWith('_@') ? 2 : 0
			) as Nip05Address;
		}
		return undefined;
	});

	s: Nip05Address | Npub | undefined = $derived.by(() => {
		return !this.pubkey ? undefined : (this.nip05 ?? nip19.npubEncode(this.pubkey));
		return undefined;
	});

	constructor(pubkey: PubKeyString) {
		this.pubkey = pubkey;
	}
}
