import { safeRelayUrl } from 'applesauce-core/helpers';

/** general nostr / helper */
export type WebSocketUrl = `wss://${string}` | `ws://${string}`;
export function isWebSocketUrl(url: string): url is WebSocketUrl {
	return !!safeRelayUrl(url);
}

export type AtLeastThreeArray<T> = [T, T, T, ...T[]];
export type PubKeyString = string;
export type Npub = `npub1${string}`;
export type Naddr = `naddr1${string}`;
export type Timestamp = number;
export type Kind = number;
export type EventIdString = string;
export type ARef = ARefP | ARefR;
/// Address Pointer Reference for Non-Parametized Replaceable
export type ARefR = `${Kind}:${PubKeyString}`;
/// Address Pointer Reference for Parametized Replaceable
export type ARefP = `${Kind}:${PubKeyString}:${string}`;

function isStringANumber(str: string) {
	return /^\d+$/.test(str);
}

export const isARefP = (s: string): s is ARefP => {
	const split = s.split(':');
	if (split.length === 3 && isStringANumber(split[0])) return true;
	return false;
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
