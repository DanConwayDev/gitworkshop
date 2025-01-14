import type { WebSocketUrl, Timestamp, PubKeyString, EventIdString } from '$lib/types';

export interface WithRelaysInfo {
	relays_info: RelaysInfo;
}

export type RelaysInfo = {
	[url in WebSocketUrl]: HuristicsForRelay;
};

export interface HuristicsForRelay {
	// cached caculated scores efficency from huristics and relay list events
	score: RelayScore;
	huristics: RelayHuristic[];
}

export const getDefaultHuristicsForRelay = (): HuristicsForRelay => {
	return {
		score: 0,
		huristics: []
	};
};

export type RelayScore = number & { _brand?: 'RelayScore' };

export function isRelayScore(n: number): n is RelayScore {
	return n >= -10 && n <= 100;
}

// RelayHint, SeenOn (Up-to-date, out-of-date, incomplete (missing statem Issues and PRs), missing), CheckOnDate,
export type RelayHuristic = RelayHint | RelayHintFromNip05 | RelayCheck;

export interface RelayHintFromNip05 {
	timestamp: Timestamp;
}

export function isRelayHintFromNip05(huristic: RelayHuristic): huristic is RelayHintFromNip05 {
	return (
		typeof huristic === 'object' &&
		huristic !== null &&
		'timestamp' in huristic &&
		typeof (huristic as RelayHintFromNip05).timestamp === 'number' &&
		!('is_child_check' in huristic)
	);
}

// event details that contained the hint
export interface RelayHint {
	author: PubKeyString;
	event_id: EventIdString;
	created_at: Timestamp;
}

export function isRelayHint(huristic: RelayHuristic): huristic is RelayHint {
	return (
		typeof huristic === 'object' &&
		huristic !== null &&
		'author' in huristic &&
		typeof (huristic as RelayHint).author === 'string' &&
		'event_id' in huristic &&
		typeof (huristic as RelayHint).event_id === 'string' &&
		'created_at' in huristic &&
		typeof (huristic as RelayHint).created_at === 'number'
	);
}

export type RelayCheck = RelayCheckFound | RelayCheckNotFound | RelayCheckWithSince;

export interface RelayCheckFound extends RelayCheckBase {
	type: 'found';
	created_at: Timestamp;
}

export interface RelayCheckNotFound extends RelayCheckBase {
	type: 'not-found';
	// up_to_date: false;
}

export interface RelayCheckWithSince extends RelayCheckBase {
	type: 'checked';
}

export interface RelayCheckBase {
	timestamp: Timestamp;
	kinds: [number];
	up_to_date: boolean;
}

export function isRelayCheck(huristic: RelayHuristic): huristic is RelayCheck {
	return (
		typeof huristic === 'object' &&
		huristic !== null &&
		'timestamp' in huristic &&
		typeof (huristic as RelayCheckBase).timestamp === 'number' &&
		'type' in huristic &&
		((huristic as RelayCheckFound).type === 'found' ||
			(huristic as RelayCheckNotFound).type === 'not-found' ||
			(huristic as RelayCheckWithSince).type === 'checked')
	);
}

export function isRelayCheckFound(huristic: RelayHuristic): huristic is RelayCheckFound {
	return isRelayCheck(huristic) && (huristic as RelayCheckFound).type === 'found';
}
