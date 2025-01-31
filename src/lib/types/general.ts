import { isHexKey, safeRelayUrl } from 'applesauce-core/helpers';
import { nip19 } from 'nostr-tools';

/** general nostr / helper */
export type WebSocketUrl = `wss://${string}` | `ws://${string}`;
export function isWebSocketUrl(url: string): url is WebSocketUrl {
	return !!safeRelayUrl(url);
}

export type AtLeastOneArray<T> = [T, ...T[]];
export type AtLeastThreeArray<T> = [T, T, T, ...T[]];
export type PubKeyString = string;

export const isPubkeyString = (s?: unknown): s is PubKeyString => {
	try {
		return !!s && typeof s === 'string' && isHexKey(s);
	} catch {
		return false;
	}
};

export type Npub = `npub1${string}`;

export const isNpub = (s: unknown): s is Npub => {
	try {
		if (nip19.decode(s as string).type === 'npub') return true;
	} catch {
		/* empty */
	}
	return false;
};

export type Naddr = `naddr1${string}`;

export const isNaddr = (s: unknown): s is Naddr => {
	try {
		if (nip19.decode(s as string).type === 'naddr') return true;
	} catch {
		/* empty */
	}
	return false;
};

export type Nnote = `note1${string}`;

export const isNnote = (s: unknown): s is Naddr => {
	try {
		if (nip19.decode(s as string).type === 'note') return true;
	} catch {
		/* empty */
	}
	return false;
};

export type Nevent = `nevent1${string}`;

export const isNevent = (s: unknown): s is Naddr => {
	try {
		if (nip19.decode(s as string).type === 'nevent') return true;
	} catch {
		/* empty */
	}
	return false;
};

export type EventBech32 = Naddr | Nevent | Nnote;

export const isEventBech32 = (s: unknown): s is EventBech32 =>
	isNaddr(s) || isNevent(s) || isNnote(s);

export type Timestamp = number;
export type Kind = number;
export type EventIdString = string;
export type ARef = ARefP | ARefR;
/// Address Pointer Reference for Non-Parametized Replaceable
export type ARefR = `${Kind}:${PubKeyString}`;
/// Address Pointer Reference for Parametized Replaceable
export type ARefP = `${Kind}:${PubKeyString}:${string}`;

export const isEventIdString = (s: EventIdString | ARef): s is EventIdString => !s.includes(':');

function isStringANumber(str: string) {
	return /^\d+$/.test(str);
}

export const isARefP = (s: string): s is ARefP => {
	const split = s.split(':');
	if (split.length === 3 && isStringANumber(split[0])) return true;
	return false;
};

export type Nip05Address = `${string}@${string}.${string}` | `${string}.${string}`;

export const isNip05 = (s: string): s is Nip05Address => {
	// Regular expression for validating domain names
	const domainRegex = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z]{2,})+$/;

	return isNip05Standardized(s) || domainRegex.test(s);
};

export type Nip05AddressStandardized = `${string}@${string}.${string}`;

// this is a bit more precise than the nostr-tools isNip05 implementation
export const isNip05Standardized = (s: string): s is Nip05AddressStandardized => {
	// Regular expression for validating email addresses (without quoted local parts)
	const emailRegex =
		/^(?!.*\.\.)([a-zA-Z0-9._%+-]+)@(?!(?:-)[A-Za-z0-9-]{1,63})([A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z]{2,})+)$/;
	return emailRegex.test(s);
};

export const standardizeNip05 = (nip05: Nip05Address): Nip05AddressStandardized => {
	if (!nip05.includes('@')) return `_@${nip05}`;
	return nip05 as Nip05AddressStandardized;
};

/** general event referencing  */
export interface EventAttribution {
	uuid: EventIdString | ARef;
	author: PubKeyString;
	created_at: Timestamp;
}
export interface ReplaceableEventAttribution extends EventAttribution {
	uuid: ARef;
	event_id: EventIdString;
	identifier: string;
}

export interface NonReplaceableEventAttribution extends EventAttribution {
	uuid: EventIdString;
}
