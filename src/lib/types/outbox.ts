import type { NostrEvent } from 'nostr-tools';
import type { EventIdString, PubKeyString, WebSocketUrl } from './general';
import type { RepoRef } from './git';

export interface OutboxItem {
	id: EventIdString;
	event: NostrEvent;
	broadly_sent: boolean;
	relay_logs: OutboxRelayLog[];
}

export interface OutboxRelayLog {
	url: WebSocketUrl;
	success: boolean;
	groups: (PubKeyString | RepoRef)[];
	try_after_timestamp?: number; // unix seconds
	attempts: OutboxSendAttempt[];
}

export interface OutboxSendAttempt {
	success: boolean;
	timestamp: number; // unix seconds
	msg: string;
}
// example messages
// error_reponses = [
//     "Error: restricted: not an active paid member",
//     "Error: blocked: not on white-list",
//     "Error",
//     "websocket error",
// ]
// no_error_resonses = [
//     "duplicate: have this event"
// ]

export interface OutboxRelayProcessorUpdate {
	id: EventIdString;
	relay: WebSocketUrl;
	success: boolean;
	msg: string;
}
