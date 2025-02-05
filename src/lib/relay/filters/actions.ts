import type { RepoRef } from '$lib/types';
import { unixNow } from 'applesauce-core/helpers';
import type { Filter } from 'nostr-tools';

export const createFetchActionsFilter = (a_ref: RepoRef): Filter[] => {
	return [
		{
			kinds: [6900],
			'#a': [a_ref],
			// within 6 months
			since: unixNow() - 60 * 60 * 24 * 30 * 6
		}
	];
};

export const createActionsNowFilter = (a_ref: RepoRef): Filter[] => {
	return [
		{
			kinds: [6900],
			'#a': [a_ref],
			since: unixNow()
		}
	];
};
