import { safeRelayUrl } from 'applesauce-core/helpers';

/** general nostr / helper */
export type WebSocketUrl = `wss://${string}` | `ws://${string}`;
export function isWebSocketUrl(url: string): url is WebSocketUrl {
	return !!safeRelayUrl(url);
}

export type AtLeastThreeArray<T> = [T, T, T, ...T[]];
export type PubKeyString = string;
export type Npub = `npub1${string}`;
export type Timestamp = number;
export type Kind = number;
export type EventIdString = string;
export type ARef = `${Kind}:${PubKeyString}:${string}`;

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
