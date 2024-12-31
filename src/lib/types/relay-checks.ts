import type { WebSocketUrl, Timestamp, EventIdString, ARef } from '$lib/types';

export interface LastCheck {
	url_and_query: string;
	url: WebSocketUrl;
	timestamp: Timestamp;
	check_initiated_at: Timestamp | undefined;
	query: 'All Repos'; // scope to add other queries eg 'All PRs and Issue' in the future
}

/** relay updates used by watcher to create relay huristics */

export type RelayUpdate = RelayUpdateUser | RelayUpdateRepoAnn | RelayUpdatePRIssue;

export type RelayUpdateUser = RelayUpdateUserFound | RelayUpdateUserNotYetFound;
export interface RelayUpdateUserFound extends RelayUpdateBase {
	type: 'found';
	event_id: EventIdString;
	uuid: ARef;
	table: 'pubkeys';
}

export interface RelayUpdateUserNotYetFound extends RelayUpdateBase {
	type: 'finding' | 'not-found';
	event_id: undefined;
	// this includes kind for either metadata or relay list
	uuid: ARef;
	table: 'pubkeys';
}

export function isRelayUpdatePubkey(update: RelayUpdate): update is RelayUpdateUser {
	return (update as RelayUpdateUser).table === 'pubkeys';
}

export interface RelayUpdateRepoAnn extends RelayUpdateBase {
	uuid: ARef;
	event_id: EventIdString;
	table: 'repos';
}

export function isRelayUpdateRepoAnn(update: RelayUpdate): update is RelayUpdateRepoAnn {
	return (update as RelayUpdateRepoAnn).table === 'repos';
}

export interface RelayUpdatePRIssue extends RelayUpdateBase {
	table: 'prs' | 'issues';
	uuid: EventIdString;
}

export function isRelayUpdatePRIssue(update: RelayUpdate): update is RelayUpdatePRIssue {
	return (
		(update as RelayUpdatePRIssue).table === 'prs' ||
		(update as RelayUpdatePRIssue).table === 'issues'
	);
}

interface RelayUpdateBase {
	type: 'found' | 'finding' | 'not-found';
	url: WebSocketUrl;
	uuid: ARef | EventIdString;
}
