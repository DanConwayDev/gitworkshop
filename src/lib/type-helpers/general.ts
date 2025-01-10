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
