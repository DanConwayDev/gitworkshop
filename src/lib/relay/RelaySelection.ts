import db from '$lib/dbs/LocalDb';
import {
	isRelayCheck,
	isRelayHint,
	isRelayHintFromNip05,
	type ARefP,
	type PubKeyString,
	type RelayCheckTimestamp,
	type RelayHuristic,
	type RelayScore,
	type RepoRef,
	type RepoTableItem,
	type WebSocketUrl
} from '$lib/types';
import { base_relays } from '$lib/query-centre/QueryCentreExternal';
import { unixNow } from 'applesauce-core/helpers';
import { issue_kind, patch_kind, repo_kind } from '$lib/kinds';

export const chooseBaseRelays = () => [...base_relays];

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
	write_relay: boolean,
	kinds: number[] = []
): RelayScore => {
	let score = 0;
	// boost if write relay
	if (write_relay) score += 50;
	// boost relays listed in nip05
	const nip05_hint = huristics.find((h) => isRelayHintFromNip05(h));
	if (nip05_hint) {
		score += 50 * getRecentTimestampMultiplier(nip05_hint.timestamp);
	}
	// boost relays with hints
	if (huristics.some((h) => isRelayHint(h))) {
		score += 20;
	}
	// boost or penalise based on historic checks
	const checks = huristics
		.filter(isRelayCheck)
		.filter((h) => kinds.some((k) => h.kinds.includes(k)))
		.sort((a, b) => a.timestamp - b.timestamp);
	let boost;
	if (checks[0]) {
		if (checks[0].up_to_date) {
			boost = 30;
		} else {
			if (checks.find((h) => h.type === 'found')) {
				// seen but out of date
				boost = -10;
			} else {
				// never seen
				boost = -30;
			}
		}
		score += boost * getRecentTimestampMultiplier(checks[0].timestamp);
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

/// returns prioritised list of relays and timestamp info
export const chooseRelaysForPubkey = async (
	pubkey: PubKeyString
): Promise<{ url: WebSocketUrl; check_timestamps: RelayCheckTimestamp }[]> => {
	// prioritise connected relays?
	// prioritise relays with items in queue, but not too many?
	const record = await db.pubkeys.get(pubkey);

	if (!record)
		return base_relays.map((url) => ({
			url,
			check_timestamps: {
				last_check: undefined,
				last_child_check: undefined,
				last_update: undefined
			}
		}));

	const scored_relays = (Object.keys(record.relays_info) as WebSocketUrl[]).sort((a, b) => {
		return record.relays_info[b].score - record.relays_info[a].score;
	});

	const selected = [
		...scored_relays,
		...base_relays.filter((base_url) => !scored_relays.includes(base_url))
	];
	return selected.map((url) => ({
		url,
		check_timestamps: {
			last_update: record.metadata.stamp?.created_at ?? undefined,
			last_check:
				record.relays_info[url]?.huristics.reduce(
					(max, h) => (isRelayCheck(h) ? Math.max(max ?? 0, h.timestamp) : max),
					undefined as number | undefined
				) ?? undefined,
			last_child_check: undefined
		}
	}));
};

/// returns prioritised list of relays and timestamp info
export const getRankedRelaysForRepo = async (
	a_ref: ARefP
): Promise<{ url: WebSocketUrl; check_timestamps: RelayCheckTimestamp }[]> => {
	// prioritise connected relays?
	// prioritise relays with items in queue, but not too many?
	const record = await db.repos.get(a_ref);

	if (!record)
		return base_relays.map((url) => ({
			url,
			check_timestamps: {
				last_check: undefined,
				last_child_check: undefined,
				last_update: undefined
			}
		}));

	const scored_relays = (Object.keys(record.relays_info) as WebSocketUrl[]).sort((a, b) => {
		return record.relays_info[b].score - record.relays_info[a].score;
	});

	const selected = [
		...scored_relays,
		...base_relays.filter((base_url) => !scored_relays.includes(base_url))
	];
	return selected.map((url) => ({
		url,
		check_timestamps: repoTableItemToRelayCheckTimestamp(record, url)
	}));
};

/// choose upto 6 relays. if there less than 6 repo relays, it will include the next 3 most likely relays to have the relivant events
export const chooseRelaysForRepo = async (
	a_ref: RepoRef,
	excluding: WebSocketUrl[] = [],
	repo_table_item?: RepoTableItem
): Promise<{ url: WebSocketUrl; check_timestamps: RelayCheckTimestamp }[]> => {
	const record = repo_table_item || (await db.repos.get(a_ref));
	return (
		(await getRankedRelaysForRepo(a_ref))
			.filter(
				({ url, check_timestamps }) =>
					// skip relays just tried
					!excluding.includes(url) &&
					// and relays checked within 30 seconds
					(!check_timestamps.last_check || check_timestamps.last_check < unixNow() - 30)
			)
			// try repo relays + 3 others limited to 6 at each try
			.slice(0, Math.min((record && record.relays ? record.relays.length : 0) + 3, 6))
	);
};

export const repoTableItemToRelayCheckTimestamp = (
	record: RepoTableItem,
	relay_url: WebSocketUrl
): RelayCheckTimestamp => ({
	last_update: record.last_activity ?? undefined,
	last_check:
		record.relays_info[relay_url]?.huristics.reduce(
			(max, h) =>
				isRelayCheck(h) && h.kinds.includes(repo_kind) ? Math.max(max ?? 0, h.timestamp) : max,
			undefined as number | undefined
		) ?? undefined,
	last_child_check:
		record.relays_info[relay_url]?.huristics.reduce(
			(max, h) =>
				isRelayCheck(h) && h.kinds.includes(issue_kind) && h.kinds.includes(patch_kind)
					? Math.max(max ?? 0, h.timestamp)
					: max,
			undefined as number | undefined
		) ?? undefined
});
