import type { WebSocketUrl, Timestamp, EventIdString, ARef } from '$lib/types';

export interface LastCheck {
	url_and_query: string;
	url: WebSocketUrl;
	timestamp: Timestamp;
	check_initiated_at: Timestamp | undefined;
	query: 'All Repos'; // scope to add other queries eg 'All PRs and Issue' in the future
}

/** relay updates used by watcher to create relay huristics */

export type RelayUpdate = RelayUpdateRepoAnn | RelayUpdatePRIssue;

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
