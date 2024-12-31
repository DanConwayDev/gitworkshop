import db from '$lib/dbs/LocalDb';
import {
	isRelayCheck,
	isRelayHint,
	type PubKeyString,
	type RelayCheck,
	type RelayHuristic,
	type RelayScore,
	type WebSocketUrl
} from '$lib/types';
import { base_relays } from '$lib/query-centre/QueryCentreExternal';
import { unixNow } from 'applesauce-core/helpers';

export const chooseRelaysForAllRepos = async () => {
	// TODO: expand this to more relays and fetch for different relays each time
	const results = await Promise.all(
		base_relays.map(async (url) => {
			const checks = await db.last_checks.get(`${url}|`);
			if (!checks) return true;
			if (checks.timestamp * 1000 < Date.now() - 5000) return true;
			return false;
		})
	);

	return base_relays.filter((_, index) => results[index]);
};

export const calculateRelayScore = (
	huristics: RelayHuristic[],
	write_relay: boolean
): RelayScore => {
	let score = 0;
	// boost if write relay
	if (write_relay) score += 50;
	// boost relays with hints
	if (huristics.some((h) => isRelayHint(h))) {
		score += 20;
	}
	// boost or penalise based on historic checks
	const check = huristics.findLast(
		(h) => isRelayCheck(h) && !h.is_child_check && typeof h.seen !== 'undefined'
	) as RelayCheck | undefined;
	if (check) {
		let boost = 0;
		if (check.seen) {
			// boost up to date
			if (check.up_to_date) boost = 30;
			// boost seen but out of date
			else boost = -10;
		}
		// penalise unseen
		else boost = -30;
		score += boost * getRecentTimestampMultiplier(check.timestamp);
	}
	return score;
};

/// huristics based on recent timestamps are much more valuable
function getRecentTimestampMultiplier(unixtime: number): number {
	const now = unixNow();
	const timeDiffSeconds = now - unixtime;

	const thresholds = [
		{ time: 30, multiplier: 1 }, // 30 seconds
		{ time: 3600, multiplier: 0.9 }, // 1 hour
		{ time: 604800, multiplier: 0.7 }, // 1 week
		{ time: 2592000, multiplier: 0.3 }, // 1 month
		{ time: 31536000, multiplier: 0.01 } // 1 year
	];

	const threshold = thresholds.find((t) => timeDiffSeconds <= t.time);

	if (threshold) {
		return threshold.multiplier;
	} else {
		return 0.01; // Return 0.01 if the timestamp is older than 1 year
	}
}

export const chooseRelaysForPubkey = async (pubkey: PubKeyString): Promise<WebSocketUrl[]> => {
	const skip_if_X_relays = 2;
	const returned_uptodate_events_X_seconds_ago = 60;

	// prioritise connected relays?
	// prioritise relays with items in queue, but not too many?
	const record = await db.pubkeys.get(pubkey);

	if (!record) return [...base_relays];

	const recently_checked = [];

	const scored_relays = Object.keys(record.relays_info).sort((a, b) => {
		if (
			record.relays_info[a as WebSocketUrl].huristics.some(
				(v) =>
					isRelayCheck(v) &&
					v.up_to_date &&
					v.timestamp > unixNow() - returned_uptodate_events_X_seconds_ago
			)
		) {
			recently_checked.push(a);
		}
		return (
			record.relays_info[b as WebSocketUrl].score - record.relays_info[a as WebSocketUrl].score
		);
	});
	if (recently_checked.length >= skip_if_X_relays) return [];

	return [...scored_relays, ...base_relays].slice(0, 3) as WebSocketUrl[];
};
