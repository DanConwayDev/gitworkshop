import { nip19 } from 'nostr-tools';
import { type ARef, type EventIdString } from './dbs/types';
import type { AddressPointer } from 'nostr-tools/nip19';
import { repo_kind } from './kinds';

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

export function aToAddressPointerAndARef(a: ARef | AddressPointer):
	| {
			a_ref: ARef;
			address_pointer: AddressPointer;
	  }
	| undefined {
	if (isAddressPointer(a)) {
		return {
			a_ref: addressPointerToARef(a),
			address_pointer: a
		};
	} else {
		const address_pointer = aRefToAddressPointer(a);
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

export const aRefToAddressPointer = (
	a: ARef | string,
	relays: string[] | undefined = undefined
): AddressPointer | undefined => {
	if (a.split(':').length !== 3) return undefined;
	const [k, pubkey, identifier] = a.split(':');
	return { kind: Number(k), pubkey, identifier, relays };
};

export const addressPointerToARef = (address_pointer: AddressPointer): ARef => {
	return `${address_pointer.kind}:${address_pointer.pubkey}:${address_pointer.identifier}`;
};

export const naddrToRepoA = (s: string): ARef | undefined => {
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
