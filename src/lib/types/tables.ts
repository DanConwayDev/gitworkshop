import type {
	LastActivity,
	WithRelaysInfo,
	PubKeyInfo,
	NonReplaceableEventAttribution,
	IssuesOrPrsByStatus,
	IssueOrPrBase,
	RepoAnn
} from '$lib/types';

export interface PubKeyTableItem extends LastActivity, WithRelaysInfo, PubKeyInfo {}

export interface RepoTableItem extends LastActivity, WithRelaysInfo, RepoAnn {
	/// undefined if no check has been carried out
	issues: IssuesOrPrsByStatus | undefined;
	/// undefined if no check has been carried out
	PRs: IssuesOrPrsByStatus | undefined;
	/// auto updated using dexie hooks
	searchWords: string[];
}

export interface IssueOrPRTableItem
	extends NonReplaceableEventAttribution,
		LastActivity,
		WithRelaysInfo,
		IssueOrPrBase {}
