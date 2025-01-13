import { repo_kind } from '$lib/kinds';
import type { PubKeyString, RepoAnnBaseFields, RepoRef } from '$lib/types';

export const getRepoShortName = (
	repo?: Partial<RepoAnnBaseFields> & { identifier: string }
): string => {
	const n = repo ? (repo.name ?? repo.identifier) : 'Untitled';
	return n.length > 45 ? `${n.slice(0, 45)}...` : n;
};

export const getRepoShortDescription = (repo?: Partial<RepoAnnBaseFields>): string => {
	const description = repo?.description ?? '';
	return description.length > 50 ? `${description.slice(0, 45)}...` : description;
};

export const getRepoRef = (repo: { identifier: string; author: PubKeyString }): RepoRef =>
	`${repo_kind}:${repo.author}:${repo.identifier}`;
