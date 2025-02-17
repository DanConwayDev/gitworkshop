import { IssueKind, PatchKind, RepoAnnKind } from '$lib/kinds';
import type {
	WebSocketUrl,
	Timestamp,
	EventIdString,
	ARef,
	RepoRef,
	PubKeyString
} from '$lib/types';

export interface LastCheck {
	url_and_query: `${WebSocketUrl}|` | `${WebSocketUrl}|${PubKeyString}`;
	url: WebSocketUrl;
	timestamp: Timestamp;
	check_initiated_at: Timestamp | undefined;
	query: 'All Repos' | PubKeyString; // scope to add other queries eg 'All PRs and Issue' in the future
}

export interface RelayCheckTimestamp {
	last_check: Timestamp | undefined;
	last_update: Timestamp | undefined;
	last_child_check: Timestamp | undefined;
}

export type RepoCheckLevel =
	/**
	 * key kinds prs and issues (planned: statuses, repo state) that tag the RepoRef of that of other maintainers
	 */
	| 'children'
	/**
	 * children and quality events that tag them ie not reactions but comments, zaps etc.
	 */
	| 'quality_grandchildren';

/** relay updates used by processor to create relay huristics */

export type RelayUpdate =
	| RelayUpdateUser
	| RelayUpdateRepoAnn
	| RelayUpdateRepoChildren
	| RelayUpdateIssue
	| RelayUpdatePR;

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

export type RelayUpdateRep = RelayUpdateRepoAnn | RelayUpdateRepoChildren;

export function isRelayUpdateRepo(update: RelayUpdate): update is RelayUpdateRep {
	return (update as RelayUpdateRep).table === 'repos';
}

export type RelayUpdateRepoAnn = (RelayUpdateFound | RelayUpdateNotFound | RelayUpdateChecked) & {
	table: 'repos';
	uuid: RepoRef;
	kinds: [30617];
};

export function isRelayUpdateRepoAnn(update: RelayUpdate): update is RelayUpdateRepoAnn {
	return (
		(update as RelayUpdateRepoAnn).table === 'repos' &&
		(update as RelayUpdateRepoAnn).kinds.length === 1 &&
		(update as RelayUpdateRepoAnn).kinds[0] == RepoAnnKind
	);
}

export type RelayUpdateRepoChildren = (
	| RelayUpdateFound
	| RelayUpdateNotFound
	| RelayUpdateChecked
) & {
	table: 'repos';
	uuid: RepoRef;
	kinds: [1617, 1621];
};

export function isRelayUpdateRepoChildren(update: RelayUpdate): update is RelayUpdateRepoChildren {
	return (
		(update as RelayUpdateRepoChildren).table === 'repos' &&
		(update as RelayUpdateRepoChildren).kinds.length === 2 &&
		(update as RelayUpdateRepoChildren).kinds.includes(PatchKind) &&
		(update as RelayUpdateRepoChildren).kinds.includes(IssueKind)
	);
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

export function isRelayUpdatePRFound(
	update: RelayUpdate
): update is RelayUpdateFound & RelayUpdatePR {
	return isRelayUpdatePR(update) && update.type === 'found';
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
	kinds: number[];
}
