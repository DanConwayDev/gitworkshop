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
	type Issue,
	type LastCheck
} from '$lib/types';
import { aRefPToAddressPointer } from '$lib/utils';
import type { EntityTable } from 'dexie';
import type { WithLoading } from './ui';

export interface SchemaV1 {
	repos: EntityTable<RepoTableItem, 'uuid'>;
	issues: EntityTable<IssueOrPRTableItem, 'uuid'>;
	prs: EntityTable<IssueOrPRTableItem, 'uuid'>;
	pubkeys: EntityTable<PubKeyTableItem, 'pubkey'>;
	last_checks: EntityTable<LastCheck, 'url_and_query'>;
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
	/// auto updated using dexie hooks
	searchWords: string[];
}

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

export interface IssueOrPRTableItem extends LastActivity, WithRelaysInfo, Issue {}
