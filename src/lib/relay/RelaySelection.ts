import db from '$lib/dbs/LocalDb';
import {
	isRelayCheck,
	isRelayHint,
	type RelayCheck,
	type RelayHuristic,
	type RelayScore
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
