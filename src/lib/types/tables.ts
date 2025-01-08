import type {
	LastActivity,
	WithRelaysInfo,
	PubKeyInfo,
	NonReplaceableEventAttribution,
	IssuesOrPrsByStatus,
	IssueOrPrBase,
	RepoAnn,
	ARefP,
	PubKeyString
} from '$lib/types';
import { aRefPToAddressPointer } from '$lib/utils';

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

export function repoTableItemDefaults(a_ref: ARefP): RepoTableItem {
	const pointer = aRefPToAddressPointer(a_ref);
	return {
		uuid: a_ref,
		identifier: pointer.identifier,
		author: pointer.pubkey,
		relays_info: {},
		last_activity: 0,
		issues: undefined,
		PRs: undefined,
		searchWords: [...[]]
	};
}

export interface IssueOrPRTableItem
	extends NonReplaceableEventAttribution,
		LastActivity,
		WithRelaysInfo,
		IssueOrPrBase {}
