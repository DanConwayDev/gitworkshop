import { memory_db_query_store } from '$lib/dbs/InMemoryRelay';
import db from '$lib/dbs/LocalDb';
import { getCacheEventsForFilters } from '$lib/dbs/LocalRelayDb';
import { repo_kind } from '$lib/kinds';
import { createPubKeyInfo, type PubKeyString } from '$lib/types';
import { TimelineQuery } from 'applesauce-core/queries';
import { Metadata, RelayList } from 'nostr-tools/kinds';
import { from, switchMap } from 'rxjs';

const hydrated_in_memory_db: string[] = [];
export class QueryCentreInternal {
	fetchAllRepos() {
		// Populate memory_db from cache
		if (!hydrated_in_memory_db.includes('repo_ann')) {
			hydrated_in_memory_db.push('repo_ann');
			getCacheEventsForFilters([{ kinds: [repo_kind] }]);
		}
		// get custom db entry

		// using applesauce querystore instead of svelte's liveQuery because we don't want every updated to seen_on to trigger a refresh
		return (
			memory_db_query_store
				.createQuery(TimelineQuery, [{ kinds: [repo_kind] }])
				// .pipe(switchMap(from(db.repos.toArray())))
				// .pipe(map((_) => async () => await db.repos.toArray()))
				.pipe(
					switchMap(() => {
						return from(db.repos.toArray());
					})
				)
		);
	}
	searchRepoAnns(query: string) {
		// Populate memory_db from cache
		if (!hydrated_in_memory_db.includes('repo_ann')) {
			hydrated_in_memory_db.push('repo_ann');
			getCacheEventsForFilters([{ kinds: [repo_kind] }]);
		}
		if (query.length === 0) this.fetchAllRepos();

		return memory_db_query_store.createQuery(TimelineQuery, [{ kinds: [repo_kind] }]).pipe(
			switchMap(() => {
				return from(
					db.repos.where('searchWords').startsWithAnyOfIgnoreCase(query).distinct().toArray()
				);
			})
		);
	}

	fetchPubkey(pubkey: PubKeyString) {
		const filter = { kinds: [Metadata, RelayList], authors: [pubkey] };
		// Populate memory_db from cache
		if (!hydrated_in_memory_db.includes(pubkey)) {
			hydrated_in_memory_db.push(pubkey);
			getCacheEventsForFilters([filter]);
		}
		return memory_db_query_store.createQuery(TimelineQuery, [filter]).pipe(
			switchMap(() => {
				return from(
					db.pubkeys.get(pubkey).then((info) => {
						return (
							info || {
								...createPubKeyInfo(pubkey),
								relays_info: {}
							}
						);
					})
				);
			})
		);
	}
}
export default QueryCentreInternal;
