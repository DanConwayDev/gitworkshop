/** git-specific types */

import { repo_kind } from '$lib/kinds';
import {
	type PubKeyString,
	type EventIdString,
	type ReplaceableEventAttribution,
	type ARefP,
	isARefP,
	type NonReplaceableEventAttribution
} from '$lib/types';

export type RepoRef = ARefP;

export const isRepoRef = (s: string | undefined): s is RepoRef => {
	return !!s && isARefP(s) && s.startsWith(repo_kind.toString());
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

export type IssuesOrPrsByStatus = {
	[K in IssueOrPrStatus]: EventIdString[];
};

export interface IssueOrPrBase {
	title: string;
	description: string;
	status: IssueOrPrStatus;
	tags: string[];
	repos: RepoRef[];
}

export interface Issue extends NonReplaceableEventAttribution, IssueOrPrBase {}

export interface Pr extends NonReplaceableEventAttribution, IssueOrPrBase {}
