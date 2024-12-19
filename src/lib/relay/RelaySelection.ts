import db from '$lib/dbs/LocalDb';
import { base_relays } from '$lib/query-centre/QueryCentreExternal';

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
