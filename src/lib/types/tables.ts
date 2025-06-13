import {
	type LastActivity,
	type WithRelaysInfo,
	type PubKeyInfo,
	type IssuesOrPrsByStatus,
	type RepoAnn,
	type ARefP,
	type PubKeyString,
	isARefP,
	type RepoRef,
	type LastCheck,
	isWithRelaysInfo,
	type OutboxItem,
	type IssueOrPr
} from '$lib/types';
import { aRefPToAddressPointer } from '$lib/utils';
import type { EntityTable } from 'dexie';
import type { WithLoading } from './ui';
import type { NostrEvent } from 'nostr-tools';

export interface SchemaV1 {
	repos: EntityTable<RepoTableItem, 'uuid'>;
	issues: EntityTable<IssueOrPRTableItem, 'uuid'>;
	prs: EntityTable<IssueOrPRTableItem, 'uuid'>;
	pubkeys: EntityTable<PubKeyTableItem, 'pubkey'>;
	last_checks: EntityTable<LastCheck, 'url_and_query'>;
	outbox: EntityTable<OutboxItem, 'id'>;
}

export type LocalDbSchema = SchemaV1;

export type LocalDbTableNames = keyof LocalDbSchema;

export interface PubKeyTableItem extends WithRelaysInfo, PubKeyInfo {}

export interface RepoTableItem extends LastActivity, WithRelaysInfo, Partial<RepoAnn> {
	uuid: ARefP;
	identifier: string;
	author: PubKeyString;
	/// undefined if no check has been carried out
	issues: IssuesOrPrsByStatus | undefined;
	/// undefined if no check has been carried out
	PRs: IssuesOrPrsByStatus | undefined;
	deletion_events?: NostrEvent[];
	deleted?: boolean;
	/// auto updated using dexie hooks
	searchWords: string[];
}

export const isRepoTableItem = (repo?: unknown): repo is RepoTableItem =>
	isWithRelaysInfo(repo) &&
	'uuid' in repo &&
	'identifier' in repo &&
	'author' in repo &&
	'issues' in repo;

export function repoTableItemDefaults(a_ref: ARefP | string): RepoTableItem & WithLoading {
	const isP = isARefP(a_ref);
	const { identifier, pubkey } = isP
		? aRefPToAddressPointer(a_ref)
		: { identifier: 'unknown', pubkey: '' };
	return {
		uuid: a_ref as RepoRef,
		identifier,
		author: pubkey,
		relays_info: {},
		last_activity: 0,
		issues: undefined,
		PRs: undefined,
		searchWords: [...[]],
		// external fetch is only called if valid RepoRef
		loading: isP
	};
}

export interface IssueOrPRTableItem extends LastActivity, WithRelaysInfo, IssueOrPr, WithEvent {}

export interface WithEvent {
	event: NostrEvent;
}
