import { isRelayCheck, type WebSocketUrl, type WithRelaysInfo } from '$lib/types';
import { unixNow } from 'applesauce-core/helpers';

export const isStrugglingToFindItem = (item: WithRelaysInfo): boolean => {
	return !foundOnOneRelay(item) && countOfRecentlyCheckedRelays(item) > 3;
};

const foundOnOneRelay = (item: WithRelaysInfo): boolean =>
	Object.keys(item.relays_info).some((relay) =>
		item.relays_info[relay as WebSocketUrl].huristics.some((h) => isRelayCheck(h) && h.up_to_date)
	);

const countOfRecentlyCheckedRelays = (item: WithRelaysInfo): number =>
	Object.keys(item.relays_info).filter((relay) =>
		item.relays_info[relay as WebSocketUrl].huristics.some(
			(h) => isRelayCheck(h) && h.timestamp > unixNow() - 60
		)
	).length;

export const recentlyCompletedCheck = (item: WithRelaysInfo): boolean =>
	Object.keys(item.relays_info).some((relay) =>
		item.relays_info[relay as WebSocketUrl].huristics.some(
			(h) => isRelayCheck(h) && h.up_to_date && h.timestamp > unixNow() - 60 * 3
		)
	);

export const lastSuccessfulCheck = (item: WithRelaysInfo): number | null => {
	let max: number = 0;
	Object.keys(item.relays_info).forEach((relay) => {
		item.relays_info[relay as WebSocketUrl].huristics.forEach((h) => {
			if (isRelayCheck(h) && h.up_to_date) max = Math.max(h.timestamp, max);
		});
	});
	return max === 0 ? null : max;
};
