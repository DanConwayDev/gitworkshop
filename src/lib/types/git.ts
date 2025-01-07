/** git-specific types */

import type { PubKeyString, EventIdString, ReplaceableEventAttribution, ARefP } from '$lib/types';

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

export type IssuesOrPrsByStatus = {
	[K in IssueOrPrStatus]: EventIdString[];
};

export interface IssueOrPrBase {
	title: string;
	descritpion: string;
	status: IssueOrPrStatus;
	tags: string[];
	repos: ARefP[];
}
