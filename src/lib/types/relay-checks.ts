import type { WebSocketUrl, Timestamp, EventIdString, ARef, RepoRef } from '$lib/types';

export interface LastCheck {
	url_and_query: string;
	url: WebSocketUrl;
	timestamp: Timestamp;
	check_initiated_at: Timestamp | undefined;
	query: 'All Repos'; // scope to add other queries eg 'All PRs and Issue' in the future
}

export interface RelayCheckTimestamp {
	last_check: Timestamp | undefined;
	last_update: Timestamp | undefined;
}
/** relay updates used by processor to create relay huristics */

export type RelayUpdate = RelayUpdateUser | RelayUpdateRepoAnn | RelayUpdateIssue | RelayUpdatePR;

export type RelayUpdateUser = (RelayUpdateFound | RelayUpdateNotFound | RelayUpdateChecked) & {
	table: 'pubkeys';
};
export interface RelayUpdateFound extends RelayUpdateBase {
	type: 'found';
	created_at: Timestamp;
	uuid: ARef | EventIdString;
}

export interface RelayUpdateNotFound extends RelayUpdateBase {
	type: 'not-found';
	// this includes kind for either metadata or relay list
	uuid: ARef | EventIdString;
}

export interface RelayUpdateChecked extends RelayUpdateBase {
	type: 'checked';
	// this includes kind for either metadata or relay list
	uuid: ARef | EventIdString;
}

export function isRelayUpdatePubkey(update: RelayUpdate): update is RelayUpdateUser {
	return (update as RelayUpdateUser).table === 'pubkeys';
}

export function isRelayUpdatePubkeyFound(
	update: RelayUpdate
): update is RelayUpdateFound & RelayUpdateUser {
	return isRelayUpdatePubkey(update) && update.type === 'found';
}

export type RelayUpdateRepoAnn = (RelayUpdateFound | RelayUpdateNotFound | RelayUpdateChecked) & {
	table: 'repos';
	uuid: RepoRef;
};

export function isRelayUpdateRepoAnn(update: RelayUpdate): update is RelayUpdateRepoAnn {
	return (update as RelayUpdateRepoAnn).table === 'repos';
}

export function isRelayUpdateRepoFound(
	update: RelayUpdate
): update is RelayUpdateFound & RelayUpdateRepoAnn {
	return isRelayUpdateRepoAnn(update) && update.type === 'found';
}

export interface RelayUpdateIssue extends RelayUpdateBase {
	table: 'issues';
	uuid: EventIdString;
}

export function isRelayUpdateIssue(update: RelayUpdate): update is RelayUpdateIssue {
	return (update as RelayUpdateIssue).table === 'issues';
}

export function isRelayUpdateIssueFound(
	update: RelayUpdate
): update is RelayUpdateFound & RelayUpdateIssue {
	return isRelayUpdateIssue(update) && update.type === 'found';
}

export interface RelayUpdatePR extends RelayUpdateBase {
	table: 'prs';
	uuid: EventIdString;
}

export function isRelayUpdatePR(update: RelayUpdate): update is RelayUpdatePR {
	return (update as RelayUpdatePR).table === 'prs';
}

export function isRelayUpdatePRIssue(
	update: RelayUpdate
): update is RelayUpdateIssue | RelayUpdatePR {
	return (
		(update as RelayUpdatePR).table === 'prs' || (update as RelayUpdateIssue).table === 'issues'
	);
}

interface RelayUpdateBase {
	type: 'found' | 'checked' | 'not-found';
	url: WebSocketUrl;
	uuid: ARef | EventIdString;
}
