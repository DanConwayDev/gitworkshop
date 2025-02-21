import { nip19, type NostrEvent } from 'nostr-tools';
import {
	isRepoRef,
	type ARef,
	type ARefP,
	type EventIdString,
	type Naddr,
	type Nevent,
	type Nnote,
	type Npub,
	type PubKeyString,
	type RepoRef,
	type RepoRoute
} from './types';
import type { AddressPointer } from 'nostr-tools/nip19';
import { PatchKind, RepoAnnKind } from './kinds';
import { getSeenRelays, isReplaceable } from 'applesauce-core/helpers';

// get value of first occurance of tag
export function getTagValue(tags: string[][], name: string): string | undefined {
	return tags.find((t) => t[0] === name)?.[1];
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

export const getRootUuid = (event: NostrEvent): EventIdString | ARef | undefined => {
	const t =
		event.tags.find((tag) => tag.length > 1 && tag[1] === 'E') ||
		event.tags.find((tag) => tag.length === 4 && tag[3] === 'root') ||
		event.tags.find((tag) => tag.length === 4 && tag[3] === 'reply') ||
		// include events that don't use nip 10 markers
		event.tags.find((tag) => tag.length < 4 && ['e', 'a'].includes(tag[0]));
	return t ? t[1] : undefined;
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

export const repoRefToPubkeyLink = (a_ref: RepoRef): `${Npub}/${string}` => {
	const pointer = aRefPToAddressPointer(a_ref);
	return `${nip19.npubEncode(pointer.pubkey)}/${pointer.identifier}`;
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

export const nostEventToNeventOrNaddr = (event: NostrEvent): Naddr | Nevent | Nnote | undefined => {
	const relays: string[] = [...(getSeenRelays(event) ?? [])].slice(0, 1);

	if (isReplaceable(event.kind)) {
		return nip19.naddrEncode({
			kind: event.kind,
			pubkey: event.pubkey,
			identifier: getTagValue(event.tags, 'd') ?? '',
			relays
		});
	} else if (relays.length > 0) {
		return nip19.neventEncode({
			kind: event.kind,
			id: event.id,
			relays,
			author: event.pubkey
		});
	} else {
		return nip19.noteEncode(event.id);
	}
};

export const getRepoRefs = (event: NostrEvent): RepoRef[] =>
	event.tags
		.filter((t) => t[0] && t[0] === 'a' && t[1] && isRepoRef(t[1]))
		.map((t) => t[1]) as RepoRef[];

export const eventIsPrRoot = (event: NostrEvent): event is NostrEvent & { kind: 1621 } => {
	const hashtags = getValueOfEachTagOccurence(event.tags, 't');
	return (
		event.kind == PatchKind && hashtags.includes('root') && !hashtags.includes('revision-root')
	);
	/// TODO root and revisions root
};
