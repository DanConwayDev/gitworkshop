import { nip19, type NostrEvent } from 'nostr-tools';
import {
	isRepoRef,
	type WebSocketUrl,
	type ARef,
	type ARefP,
	type EventIdString,
	type Naddr,
	type Npub,
	type PubKeyString,
	type RepoRef,
	type RepoRoute,
	isWebSocketUrl,
	isEventIdString,
	type EventTag,
	type IssueOrPRTableItem
} from './types';
import type { AddressPointer, EventPointer, NEvent } from 'nostr-tools/nip19';
import { IssueKind, PatchKind, PrKind, RepoAnnKind } from './kinds';
import { getSeenRelays } from 'applesauce-core/helpers';
import { isReplaceableKind } from 'nostr-tools/kinds';

// get value of first occurance of tag
export function getTagValue(tags: string[][], name: string): string | undefined {
	return tags.find((t) => t[0] === name)?.[1];
}

export function getParamTagValue(tags: string[][], name: string): string | undefined {
	return tags.find((t) => t.length > 2 && t[0] === 'param' && t[1] === name)?.[2];
}

// get value of each occurance of tag
export function getValueOfEachTagOccurence(tags: string[][], name: string): string[] {
	return tags.filter((t) => t[0] === name).map((t) => t[1]);
}

// get values of first occurance of tag
export function getTagMultiValue(tags: string[][], name: string): string[] | undefined {
	const foundTag = tags.find((t) => t[0] === name);
	return foundTag ? foundTag.slice(1) : undefined;
}

export const getParentUuid = (reply: NostrEvent): EventIdString | ARef | undefined => {
	const t =
		reply.tags.find((tag) => tag.length === 4 && tag[3] === 'reply') ||
		reply.tags.find((tag) => tag.length === 4 && tag[3] === 'root') ||
		// include events that don't use nip 10 markers, this includes nip22
		reply.tags.find((tag) => tag.length < 4 && ['e', 'a'].includes(tag[0]));
	return t ? t[1] : undefined;
};

export const getRootTag = (event: NostrEvent): EventTag | undefined => {
	return (event.tags.find((tag) => tag.length > 1 && tag[0] === 'E') ||
		event.tags.find((tag) => tag.length === 4 && tag[3] === 'root') ||
		event.tags.find((tag) => tag.length === 4 && tag[3] === 'reply') ||
		event.tags.find((tag) => tag.length < 4 && ['e', 'a'].includes(tag[0])) ||
		undefined) as EventTag | undefined;
};

export const getRootPointer = (event: NostrEvent): EventPointer | AddressPointer | undefined => {
	const tag = getRootTag(event);
	if (tag) {
		const pointer = eventTagToPointer(tag);
		if (pointer) return pointer;
	}
	return undefined;
};

export const getRootUuid = (event: NostrEvent): EventIdString | ARef | undefined => {
	const t = getRootTag(event);
	return t ? t[1] : undefined;
};

export const getStandardnip10ReplyTags = (
	event: NostrEvent,
	issue_or_pr_table_item?: IssueOrPRTableItem
): string[][] => {
	let root_id: string | undefined;
	if (event.kind === PatchKind && event.tags.some((t) => t[0] === 't' && t[1] === 'root'))
		root_id = event.id;
	if (!root_id) root_id = getRootUuid(event);
	if (!root_id && issue_or_pr_table_item) root_id = issue_or_pr_table_item.uuid;
	if (!root_id) root_id = event.id;
	return [
		['e', root_id, '', 'root'],
		['e', event.id, eventToSeenOnRelay(event) || '', 'reply']
	];
};

export const getStandardnip22ReplyTags = (
	event: NostrEvent,
	issue_or_pr_table_item?: IssueOrPRTableItem
): string[][] => {
	const P = getRootEventPubkey(event, issue_or_pr_table_item);
	let root_id: string | undefined;
	if (
		event.kind === IssueKind ||
		(event.kind === PatchKind && event.tags.some((t) => t[0] === 't' && t[1] === 'root'))
	)
		root_id = event.id;
	if (!root_id) root_id = getRootUuid(event);
	if (!root_id && issue_or_pr_table_item) root_id = issue_or_pr_table_item.uuid;
	if (!root_id) root_id = event.id;
	return [
		['E', root_id, '', P],
		['K', getRootKind(event, issue_or_pr_table_item)],
		['P', P],
		['k', `${event.kind}`],
		['p', event.pubkey],
		['e', event.id, eventToSeenOnRelay(event) || '', event.pubkey]
	];
};

const getRootKind = (event: NostrEvent, issue_or_pr_table_item?: IssueOrPRTableItem): string => {
	const K = event.tags.find((t) => t.length > 1 && t[0] === 'K');
	if (K) return K[1];
	if (event.id === (getRootUuid(event) || issue_or_pr_table_item?.uuid) || !issue_or_pr_table_item)
		return `${event.kind}`;
	return `${issue_or_pr_table_item.event.kind}`;
};

const getRootEventPubkey = (
	event: NostrEvent,
	issue_or_pr_table_item?: IssueOrPRTableItem
): string => {
	const K = event.tags.find((t) => t.length > 1 && t[0] === 'P');
	if (K) return K[1];
	if (event.id === (getRootUuid(event) || issue_or_pr_table_item?.uuid)) return event.pubkey;
	if (issue_or_pr_table_item) return issue_or_pr_table_item.author;
	return event.pubkey;
};

export const eventToSeenOnRelay = (event: NostrEvent): WebSocketUrl | undefined => {
	const relays = getSeenRelays(event);
	if (relays)
		for (const url of relays.values()) {
			if (isWebSocketUrl(url)) return url;
		}
	return undefined;
};

export const eventToNip19 = (event: NostrEvent): NEvent | Naddr => {
	const relay_hint = eventToSeenOnRelay(event);
	if (isReplaceableKind(event.kind)) {
		const d = getTagValue(event.tags, 'd');
		return nip19.naddrEncode({
			kind: event.kind,
			pubkey: event.pubkey,
			...(d ? { identifier: d } : {}),
			...(relay_hint ? { relays: [relay_hint] } : {})
		} as AddressPointer);
	}
	return nip19.neventEncode({
		id: event.id,
		kind: event.kind,
		author: event.pubkey,
		...(relay_hint ? { relays: [relay_hint] } : {})
	});
};

export const eventTagToNip19 = (tag: EventTag): NEvent | Naddr | undefined => {
	const pointer = eventTagToPointer(tag);
	if (pointer) {
		if (pointer.kind) return nip19.naddrEncode(pointer as AddressPointer);
		else return nip19.neventEncode(pointer as EventPointer);
	}
	return undefined;
};

export const eventTagToPointer = (tag: EventTag): EventPointer | AddressPointer | undefined => {
	if (tag.length < 2) return undefined;
	let relays: WebSocketUrl[] = [];
	if (tag.length > 2) {
		if (isWebSocketUrl(tag[2])) relays = [tag[2]];
	}
	// TODO add support for non paramaetised
	if (tag[1].includes(':')) {
		return aRefToAddressPointer(tag[1], relays);
	}
	if (isEventIdString(tag[1])) {
		return {
			id: tag[1],
			relays
		} as EventPointer;
	}
	return undefined;
};

export const getRootNip19 = (event: NostrEvent): Naddr | NEvent | undefined => {
	const t = getRootTag(event);
	if (t) return eventTagToNip19(t);
	return undefined;
};

function isAddressPointer(a: ARef | AddressPointer): a is AddressPointer {
	return typeof a !== 'string';
}

export function aToAddressPointerAndARef(a: ARefP | AddressPointer):
	| {
			a_ref: ARefP;
			address_pointer: AddressPointer;
	  }
	| undefined {
	if (isAddressPointer(a)) {
		return {
			a_ref: addressPointerToARefP(a),
			address_pointer: a
		};
	} else {
		const address_pointer = aRefPToAddressPointer(a);
		if (address_pointer) {
			return {
				address_pointer: address_pointer,
				a_ref: a
			};
		}
	}
	return undefined;
}

export const naddrToPointer = (s: string): AddressPointer | undefined => {
	try {
		const decoded = nip19.decode(s);
		if ('identifier' in (decoded.data as AddressPointer)) {
			return decoded.data as AddressPointer;
		}
	} catch {
		return undefined;
	}
};

export const repoRouteToARef = (
	repo_route: RepoRoute,
	nip05_result?: { user?: { pubkey: PubKeyString } }
): RepoRef | undefined => {
	if (repo_route.type === 'nip05') {
		return nip05_result && nip05_result.user
			? (`${RepoAnnKind}:${nip05_result.user.pubkey}:${repo_route.identifier}` as RepoRef)
			: undefined;
	}
	return `${RepoAnnKind}:${repo_route.pubkey}:${repo_route.identifier}` as RepoRef;
};

export const aRefPToAddressPointer = (
	a: ARefP,
	relays: string[] | undefined = undefined
): AddressPointer => {
	const [k, pubkey, identifier] = a.split(':');
	return { kind: Number(k), pubkey, identifier, relays };
};

// TODO add support for non paramaetised
export function aRefToAddressPointer(a: string, relays?: string[]): AddressPointer | undefined;
export function aRefToAddressPointer(a: ARefP, relays?: string[]): AddressPointer;
export function aRefToAddressPointer(
	a: ARefP | string,
	relays: string[] | undefined = undefined
): AddressPointer | undefined {
	if (a.split(':').length !== 3) return undefined;
	const [k, pubkey, identifier] = a.split(':');
	return { kind: Number(k), pubkey, identifier, relays };
}

export const addressPointerToARefP = (address_pointer: AddressPointer): ARefP => {
	return `${address_pointer.kind}:${address_pointer.pubkey}:${address_pointer.identifier}`;
};

export const addressPointerToRepoRef = (address_pointer: AddressPointer): RepoRef => {
	return `${RepoAnnKind}:${address_pointer.pubkey}:${address_pointer.identifier}`;
};

export const naddrToRepoA = (s: string): RepoRef | undefined => {
	const pointer = naddrToPointer(s);
	if (pointer && pointer.kind === RepoAnnKind)
		return `${RepoAnnKind}:${pointer.pubkey}:${pointer.identifier}`;
	return undefined;
};

export function aToNaddr(a: string): Naddr | undefined;
export function aToNaddr(a: AddressPointer): Naddr;
export function aToNaddr(a: string | AddressPointer) {
	const a_ref = typeof a === 'string' ? aRefToAddressPointer(a) : a;
	if (!a_ref) return undefined;
	return nip19.naddrEncode(a_ref);
}

export const repoRefToPubkeyLink = (
	a_ref: RepoRef,
	relay?: WebSocketUrl[]
): `${Npub}/${string}` => {
	const pointer = aRefPToAddressPointer(a_ref);
	const hint =
		relay && relay.length > 0 ? `/${encodeURIComponent(relay[0].replace('wss://', ''))}` : '';
	return `${nip19.npubEncode(pointer.pubkey)}${hint}/${pointer.identifier}`;
};

export const neventOrNoteToHexId = (s: string): EventIdString | undefined => {
	try {
		const decoded = nip19.decode(s);
		if (decoded.type === 'note') return decoded.data;
		else if (decoded.type === 'nevent') return decoded.data.id;
	} catch {
		/* empty */
	}
	return undefined;
};

export const getRepoRefs = (event: NostrEvent): RepoRef[] =>
	event.tags
		.filter((t) => t[0] && t[0] === 'a' && t[1] && isRepoRef(t[1]))
		.map((t) => t[1]) as RepoRef[];

export const eventIsPrRoot = (event: NostrEvent): event is NostrEvent & { kind: 1617 | 1618 } => {
	const hashtags = getValueOfEachTagOccurence(event.tags, 't');
	return (
		event.kind == PrKind ||
		(event.kind == PatchKind && hashtags.includes('root') && !hashtags.includes('revision-root'))
	);
	/// TODO root and revisions root
};
