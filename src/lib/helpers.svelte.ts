import { liveQuery } from 'dexie';

/// this is taken from https://github.com/dexie/Dexie.js/pull/2116
/// when merged the version from the library should be used
export function stateQuery<T>(
	querier: () => T | Promise<T>,
	dependencies?: () => unknown[]
): { current?: T } {
	const query = $state<{ current?: T }>({ current: undefined });
	$effect(() => {
		dependencies?.();
		return liveQuery(querier).subscribe((result) => {
			if (result !== undefined) {
				query.current = result;
			}
		}).unsubscribe;
	});
	return query;
}

// this is custom but DanConwayDev suggested it for inclusion in the library
export function liveQueryState<T>(
	querier: () => T | Promise<T | undefined>,
	dependencies: () => unknown[] = () => []
): { current?: T } {
	return stateQuery(querier, dependencies);
}
