import { ActionDvmRequestKind, ActionDvmResponseKind } from '$lib/kinds';
import type { EventIdString, RepoRef } from '$lib/types';
import { unixNow } from 'applesauce-core/helpers';
import type { Filter } from 'nostr-tools';
import { Handlerinformation } from 'nostr-tools/kinds';

export const createActionDVMProvidersFilter = (): Filter[] => {
	return [
		{
			kinds: [Handlerinformation],
			'#k': [ActionDvmRequestKind.toString()]
		}
	];
};
export const createWatchActionsFilter = (a_ref: RepoRef): Filter[] => {
	return [
		{
			kinds: [ActionDvmRequestKind, ActionDvmResponseKind],
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
		{
			kinds: [ActionDvmResponseKind],
			'#a': [a_ref],
			'#s': ['error', 'payment-required', 'success'],
			limit: 100,
			// within 6 months
			since: unixNow() - 60 * 60 * 24 * 30 * 6
		}
	];
};

export const createActionsRequestFilter = (request_id: EventIdString): Filter[] => {
	return [
		{
			kinds: [ActionDvmResponseKind],
			'#e': [request_id]
		}
	];
};
