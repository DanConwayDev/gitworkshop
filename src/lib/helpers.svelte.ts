import { liveQuery } from 'dexie';

/// this is taken and adapted from https://github.com/dexie/Dexie.js/pull/2116
/// when merged the version from the library should be used

export function liveQueryState<T>(querier: () => T | Promise<T>, dependencies?: () => unknown[]) {
	const query = $state<{ current?: T; isLoading: boolean; error?: unknown }>({
		current: undefined,
		isLoading: true,
		error: undefined
	});
	$effect(() => {
		dependencies?.();
		query.isLoading = true;
		return liveQuery(querier).subscribe(
			(result) => {
				query.isLoading = false;
				query.error = undefined;
				query.current = result;
			},
			(error) => {
				query.error = error;
				query.isLoading = false;
			}
		).unsubscribe;
	});
	return query;
}
