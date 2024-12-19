import db from '$lib/dbs/LocalDb';
import type { RepoAnn, SeenOn, WebSocketUrl } from '$lib/dbs/types';
import { base_relays } from '$lib/query-centre/QueryCentreExternal';
import { safeRelayUrls, unixNow } from 'applesauce-core/helpers';

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

export const chooseRelaysForRepo = async (entry: RepoAnn & SeenOn) => {
	const scores: Map<WebSocketUrl, number> = new Map();
	// boost repo relays
	(safeRelayUrls(entry.relays) as WebSocketUrl[]).forEach((relay) => {
		scores.set(relay, 50);
	});
	entry.seen_on.forEach((seen_on, relay) => {
		// boost relays with hints
		if (seen_on.hints.length > 0) {
			scores.set(relay, (scores.get(relay) || 0) + 20);
		}
		// boost seen
		if (seen_on.seen !== undefined) {
			let boost = 0;
			const multiplier = getRecentTimestampMultiplier(seen_on.last_check);
			if (seen_on.seen) {
				// boost up to date
				if (seen_on.up_to_date) boost = 30;
				// boost seen but out of date
				else boost = 10;
			}
			// penalise unseen
			else boost = -30;
			scores.set(relay, (scores.get(relay) || 0) + boost * multiplier);
		}
	});
};

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
