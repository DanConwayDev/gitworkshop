/** git-specific types */

import { repo_kind } from '$lib/kinds';
import {
	type PubKeyString,
	type EventIdString,
	type ReplaceableEventAttribution,
	type ARefP,
	isARefP,
	type NonReplaceableEventAttribution,
	type Naddr
} from '$lib/types';
import { nip19 } from 'nostr-tools';

export type RepoRef = ARefP;

export const isRepoRef = (s?: unknown): s is RepoRef => {
	return !!s && typeof s === 'string' && isARefP(s) && s.startsWith(repo_kind.toString());
};

export const isRepoNaddr = (s: unknown): s is Naddr => {
	try {
		const t = nip19.decode(s as string);
		if (t.type === 'naddr' && t.data.kind === repo_kind) {
			return true;
		}
	} catch {
		/* empty */
	}
	return false;
};

export interface RepoAnnBaseFields {
	identifier: string;
	unique_commit: string | undefined;
	name: string;
	description: string;
	clone: string[];
	web: string[];
	tags: string[];
	maintainers: PubKeyString[];
	relays: string[];
}

export interface RepoAnn extends ReplaceableEventAttribution, RepoAnnBaseFields {}

export enum IssueOrPrStatus {
	Open = 1630,
	Applied = 1631,
	Closed = 1632,
	Draft = 1633
}
export const getIssueOrPrStatus = (kind: number): IssueOrPrStatus | undefined => {
	if (Object.values(IssueOrPrStatus).includes(kind as IssueOrPrStatus)) {
		return kind as IssueOrPrStatus;
	}
	return undefined;
};

export interface StatusHistoryItem {
	status: IssueOrPrStatus;
	pubkey: PubKeyString;
	created_at: number;
}

export type IssuesOrPrsByStatus = {
	[K in IssueOrPrStatus]: EventIdString[];
};

export type ChildEventRef = {
	id: EventIdString;
	kind: number,
	pubkey: PubKeyString;
}

export interface IssueOrPrBase {
	type: 'issue' | 'pr';
	title: string;
	description: string;
	status: IssueOrPrStatus;
	status_history: StatusHistoryItem[];
	quality_children: ChildEventRef[];
	quality_children_count: number;
	tags: string[];
	repos: RepoRef[];
}

export interface IssueOrPr extends NonReplaceableEventAttribution, IssueOrPrBase {}

export type Issue = IssueOrPr;

export type Pr = IssueOrPr;

export interface RepoReadme {
	md: string;
	loading: boolean;
	failed: boolean;
}

export const readme_defaults: RepoReadme = {
	md: '',
	loading: true,
	failed: false
};
