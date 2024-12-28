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
export type RelayHuristic = RelayHint | RelayHintFromBech32 | RelayCheck;

export interface RelayHintFromBech32 {
	timestamp: Timestamp;
}

export function isRelayHintFromBech32(huristic: RelayHuristic): huristic is RelayHintFromBech32 {
	return (
		typeof huristic === 'object' &&
		huristic !== null &&
		'timestamp' in huristic &&
		typeof (huristic as RelayHintFromBech32).timestamp === 'number' &&
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

export interface RelayCheck {
	/// if seen is undefined this is in progress start timestamp otherwise timestamp receieved
	timestamp: Timestamp;
	// true if checking for children (ie. for Repo: PRs/Issues/State of Repo, for PRs, comments, patches etc)
	is_child_check: boolean;
	/// undefined if check not yet complete, if is_check_check - true when at least one child event
	seen: boolean | undefined;
	/// undefined if check not yet complete or not seen, if is_check_check, true when has all (or most) child events
	up_to_date: boolean | undefined;
}

export const relay_check_defaults: RelayCheck = {
	timestamp: 0,
	is_child_check: false,
	seen: undefined,
	up_to_date: undefined
};

export function isRelayCheck(huristic: RelayHuristic): huristic is RelayCheck {
	return (
		typeof huristic === 'object' &&
		huristic !== null &&
		'timestamp' in huristic &&
		(typeof (huristic as RelayCheck).timestamp === 'number' ||
			(huristic as RelayCheck).timestamp === undefined) &&
		'is_child_check' in huristic &&
		typeof (huristic as RelayCheck).is_child_check === 'boolean' &&
		'seen' in huristic &&
		(typeof (huristic as RelayCheck).seen === 'boolean' ||
			(huristic as RelayCheck).seen === undefined) &&
		'up_to_date' in huristic &&
		(typeof (huristic as RelayCheck).up_to_date === 'boolean' ||
			(huristic as RelayCheck).up_to_date === undefined)
	);
}
