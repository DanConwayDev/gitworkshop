import { nip19, type NostrEvent } from 'nostr-tools';
import { isRepoRef, type ARef, type ARefP, type EventIdString, type RepoRef } from './types';
import type { AddressPointer } from 'nostr-tools/nip19';
import { repo_kind } from './kinds';
import { liveQuery } from 'dexie';

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
	const decoded = nip19.decode(s);
	if (typeof decoded.data === 'string' || !Object.keys(decoded.data).includes('identifier'))
		return undefined;
	return decoded.data as AddressPointer;
};

export const aRefPToAddressPointer = (
	a: ARefP,
	relays: string[] | undefined = undefined
): AddressPointer => {
	const [k, pubkey, identifier] = a.split(':');
	return { kind: Number(k), pubkey, identifier, relays };
};

export const aRefToAddressPointer = (
	a: ARefP | string,
	relays: string[] | undefined = undefined
): AddressPointer | undefined => {
	if (a.split(':').length !== 3) return undefined;
	const [k, pubkey, identifier] = a.split(':');
	return { kind: Number(k), pubkey, identifier, relays };
};

export const addressPointerToARefP = (address_pointer: AddressPointer): ARefP => {
	return `${address_pointer.kind}:${address_pointer.pubkey}:${address_pointer.identifier}`;
};

export const naddrToRepoA = (s: string): RepoRef | undefined => {
	const pointer = naddrToPointer(s);
	if (pointer && pointer.kind === repo_kind)
		return `${repo_kind}:${pointer.pubkey}:${pointer.identifier}`;
	return undefined;
};

export const aToNaddr = (a: string | AddressPointer): `naddr1${string}` | undefined => {
	const a_ref = typeof a === 'string' ? aRefToAddressPointer(a) : a;
	if (!a_ref) return undefined;
	return nip19.naddrEncode(a_ref);
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

/// this is taken from https://github.com/dexie/Dexie.js/pull/2116
/// this should be taken from the dexie when it is merged
export function stateQuery<T>(
	querier: () => T | Promise<T>,
	dependencies?: () => unknown[]
): { current?: T } {
	const query = $state<{ current?: T }>({ current: undefined });
	$effect(() => {
		dependencies?.();
		return liveQuery(querier).subscribe((result) => {
			if (result !== undefined) {
				query.current = result;
			}
		}).unsubscribe;
	});
	return query;
}
