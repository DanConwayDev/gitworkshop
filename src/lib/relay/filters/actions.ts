import {
	ActionDvmRequestQuoteKind,
	ActionDvmQuoteResponseKind,
	ActionDvmRequestKind,
	ActionDvmResponseKind
} from '$lib/kinds';
import type { EventIdString, RepoRef } from '$lib/types';
import { unixNow } from 'applesauce-core/helpers';
import type { Filter } from 'nostr-tools';

export const createWatchActionsFilter = (a_ref: RepoRef): Filter[] => {
	return [
		{
			kinds: [
				ActionDvmRequestQuoteKind,
				ActionDvmQuoteResponseKind,
				ActionDvmRequestKind,
				ActionDvmResponseKind
			],
			'#a': [a_ref]
		}
	];
};

export const createRecentActionsRequestFilter = (a_ref: RepoRef): Filter[] => {
	return [
		{
			kinds: [ActionDvmRequestKind],
			'#a': [a_ref],
			limit: 100,
			// within 6 months
			since: unixNow() - 60 * 60 * 24 * 30 * 6
		}
	];
};

export const createRecentActionsResultFilter = (a_ref: RepoRef): Filter[] => {
	return [
		...createRecentActionsRequestFilter(a_ref),
		{
			kinds: [ActionDvmResponseKind],
			'#a': [a_ref],
			'#s': ['error', 'success'],
			limit: 100,
			// within 6 months
			since: unixNow() - 60 * 60 * 24 * 30 * 6
		}
	];
};

export const createActionsRequestFilter = (request_id: EventIdString): Filter[] => {
	return [
		{
			kinds: [ActionDvmQuoteResponseKind],
			'#e': [request_id]
		}
	];
};
