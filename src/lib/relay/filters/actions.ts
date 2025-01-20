import type { RepoRef } from '$lib/types';
import type { Filter } from 'nostr-tools';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createFetchActionsFilter = (a_ref: RepoRef): Filter[] => {
	return [
		{
			authors: ['bbb5dda0e15567979f0543407bdc2033d6f0bbb30f72512a981cfdb2f09e2747'],
			kinds: [1],
			limit: 2
		}
	];
};
