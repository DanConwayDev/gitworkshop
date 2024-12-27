import type { WebSocketUrl, Timestamp, PubKeyString, Npub, EventIdString } from '$lib/types';
import { type ProfileContent } from 'applesauce-core/helpers';

interface PubkeyEventStamp {
	event_id: EventIdString;
	created_at: Timestamp;
}

export interface PubKeyMetadataInfo {
	fields: ProfileContent;
	stamp: PubkeyEventStamp | undefined;
}

export interface PubKeyRelayInfo {
	read: WebSocketUrl[];
	write: WebSocketUrl[];
	relay_hints_found: WebSocketUrl[];
	stamp: PubkeyEventStamp | undefined;
}
export interface PubKeyInfo {
	pubkey: PubKeyString;
	npub: Npub;
	metadata: PubKeyMetadataInfo;
	relays: PubKeyRelayInfo;
}
