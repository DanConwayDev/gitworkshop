import { liveQuery } from 'dexie';
import { nip19, type Filter, type NostrEvent } from 'nostr-tools';
import { memory_db_query_store } from './dbs/InMemoryRelay';
import {
	isNpub,
	isRepoRef,
	isWebSocketUrl,
	type EventIdString,
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
import { onDestroy as onDestroySvelte, untrack } from 'svelte';
import type { AddressPointer, EventPointer } from 'nostr-tools/nip19';
import { RepoAnnKind } from './kinds';
import type { QueryConstructor } from 'applesauce-core';

/// this is taken and adapted from https://github.com/dexie/Dexie.js/pull/2116
/// when merged the version from the library should be used

export function liveQueryState<T>(
	querier: () => T | Promise<T>,
	dependencies?: () => unknown[],
	onDestroy?: () => void
) {
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

	onDestroySvelte(() => {
		onDestroy?.();
	});

	return query;
}

export function inMemoryRelayTimeline(
	filters: Filter[],
	dependencies?: () => unknown[],
	onDestroy?: () => void
) {
	const result = $state<{ timeline: NostrEvent[] }>({ timeline: [] });
	$effect(() => {
		dependencies?.();
		const sub = memory_db_query_store.timeline(filters).subscribe((events) => {
			result.timeline = [...(events ?? [])];
		});
		return () => {
			sub.unsubscribe();
		};
	});

	onDestroySvelte(() => {
		onDestroy?.();
	});
	return result;
}

export function inMemoryRelayTimelineRecursiveThread(
	root_event_id: EventIdString,
	dependencies?: () => unknown[],
	onDestroy?: () => void
) {
	const ids = $state([root_event_id]);
	const filters: Filter[] = $derived([{ '#e': ids }, { '#E': ids }]);
	const result = $state<{ timeline: NostrEvent[] }>({ timeline: [] });
	$effect(() => {
		dependencies?.();
		const sub = memory_db_query_store.timeline(filters).subscribe((events) => {
			result.timeline = [...(events ?? [])];
			(events ?? []).forEach((e) => {
				if (!ids.includes(e.id)) ids.push(e.id);
			});
		});
		return () => {
			sub.unsubscribe();
		};
	});

	onDestroySvelte(() => {
		onDestroy?.();
	});
	return result;
}

export function inMemoryRelayEvent(
	event_ref: EventPointer | AddressPointer | EventIdString | undefined,
	dependencies?: () => unknown[],
	onDestroy?: () => void
) {
	const result = $state<{ event: NostrEvent | undefined }>({ event: undefined });
	$effect(() => {
		dependencies?.();
		if (!event_ref) return;
		const sub = (
			typeof event_ref === 'string' || !('identifier' in event_ref)
				? memory_db_query_store.event(typeof event_ref === 'string' ? event_ref : event_ref.id)
				: memory_db_query_store.replaceable(event_ref.kind, event_ref.pubkey, event_ref.identifier)
		).subscribe((event) => {
			result.event = event;
		});
		return () => {
			sub.unsubscribe();
		};
	});
	onDestroySvelte(() => {
		onDestroy?.();
	});

	return result;
}
/**
 * The class design pattern is used here for turning the Observable into
 * a state object so that raw Query response can be retunred instead of
 * a proxy object
 * */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class InMemoryQuery<T, Args extends Array<any>> {
	result = $state.raw<T | undefined>(undefined);
	constructor(queryConstructor: QueryConstructor<T, Args>, args: () => Args) {
		$effect(() => {
			const sub = memory_db_query_store
				.createQuery(queryConstructor, ...args())
				.subscribe((res: T | undefined) => {
					this.result = res;
				});
			return () => {
				sub.unsubscribe();
			};
		});
	}
}

export class RepoRouteStringCreator {
	private a_ref: RepoRef;
	private pointer: AddressPointer | undefined = undefined;
	private nip_creator = $derived(
		this.pointer && store.url_pref === 'nip05'
			? new UserRouteStringCreator(this.pointer.pubkey)
			: undefined
	);
	s: RepoRouteString = $derived.by(() => {
		if (this.pointer && this.a_ref) {
			if (store.url_pref === 'naddr') return aToNaddr(this.pointer);
			else if (store.url_pref === 'nip05' && this.nip_creator?.s && !isNpub(this.nip_creator?.s)) {
				return `${this.nip_creator.s}/${this.pointer.identifier}` as RepoRouteNip05String;
			} else return repoRefToPubkeyLink(this.a_ref, this.pointer.relays?.filter(isWebSocketUrl));
		}
		// unreachable see https://github.com/sveltejs/svelte/issues/11116
		return `${RepoAnnKind}:<a_ref and pointer will never be undefined>:<svelte-5-sucks>` as RepoRouteString;
	});

	type = $derived(this.s.startsWith('npub1') ? 'npub' : store.url_pref);
	identifier: string;
	pubkey: PubKeyString;

	constructor(a_ref_or_table_item: RepoRef | RepoTableItem, relay?: WebSocketUrl) {
		this.a_ref = isRepoRef(a_ref_or_table_item)
			? a_ref_or_table_item
			: repoToRepoRef(a_ref_or_table_item);
		const relays = relay
			? [relay]
			: isRepoRef(a_ref_or_table_item)
				? []
				: firstRelay(a_ref_or_table_item?.relays);
		this.identifier = this.a_ref.split(':').slice(-1)[0];
		this.pubkey = this.a_ref.split(':')[0];
		this.pointer = aRefPToAddressPointer(this.a_ref, relays);
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
			return untrack(() =>
				query_centre.fetchNip05(this.profile_query?.current?.metadata.fields.nip05 as Nip05Address)
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
	});

	constructor(pubkey: PubKeyString) {
		this.pubkey = pubkey;
	}
}

/**
 * Svelte action that, when its parameter is truthy,
 * waits one tick and then scrolls the node into view.
 */
export function scrollWhen(node: HTMLElement, shouldScroll: boolean) {
	let timeout: ReturnType<typeof setTimeout>;

	function doScroll(flag: boolean) {
		if (flag) {
			// next microtask / tick
			timeout = setTimeout(() => {
				node.scrollIntoView({ behavior: 'smooth' });
			}, 0);
		}
	}

	// do it on init
	doScroll(shouldScroll);

	return {
		update(newShouldScroll: boolean) {
			doScroll(newShouldScroll);
		},
		destroy() {
			clearTimeout(timeout);
		}
	};
}
