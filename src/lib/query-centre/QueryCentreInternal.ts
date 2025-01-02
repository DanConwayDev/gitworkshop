import db from '$lib/dbs/LocalDb';
import { getCacheEventsForFilters } from '$lib/dbs/LocalRelayDb';
import { repo_kind } from '$lib/kinds';
import { createPubKeyInfo, type PubKeyString } from '$lib/types';
import { liveQuery } from 'dexie';
import { Metadata, RelayList } from 'nostr-tools/kinds';

const hydrated_in_memory_db: string[] = [];
export class QueryCentreInternal {
	fetchAllRepos() {
		// Populate memory_db from cache
		if (!hydrated_in_memory_db.includes('repo_ann')) {
			hydrated_in_memory_db.push('repo_ann');
			getCacheEventsForFilters([{ kinds: [repo_kind] }]);
		}
		return liveQuery(async () => {
			return await db.repos.toArray();
		});
	}
	searchRepoAnns(query: string) {
		// Populate memory_db from cache
		if (!hydrated_in_memory_db.includes('repo_ann')) {
			hydrated_in_memory_db.push('repo_ann');
			getCacheEventsForFilters([{ kinds: [repo_kind] }]);
		}
		if (query.length === 0) this.fetchAllRepos();
		return liveQuery(async () => {
			return await db.repos
				.where('searchWords')
				.startsWithAnyOfIgnoreCase(query)
				.distinct()
				.toArray();
		});
	}

	fetchPubkey(pubkey: PubKeyString) {
		const filter = { kinds: [Metadata, RelayList], authors: [pubkey] };
		// Populate memory_db from cache
		if (!hydrated_in_memory_db.includes(pubkey)) {
			hydrated_in_memory_db.push(pubkey);
			getCacheEventsForFilters([filter]);
		}
		// using applesauce querystore instead of svelte's liveQuery because we don't to reload on every to every pubkey
		// note: for this to work we will need to ms before update has made its way into the db via watcher.
		// return memory_db_query_store.createQuery(TimelineQuery, [filter]).pipe(
		// 	switchMap((es) => {
		// 		return from(
		// 			db.pubkeys.get(pubkey).then((info) => {
		// 				if (info) return info;
		// 				const m = es.find((e) => e.kind === Metadata);
		// 				return (
		// 					info || {
		// 						...createPubKeyInfo(pubkey),
		// 						// for the few ms before the event has made it into the cache
		// 						metadata: { fields: m ? getProfileContent(m) : {}, stamp: undefined }
		// 					}
		// 				);
		// 			})
		// 		);
		// 	})
		// );
		return liveQuery(async () => {
			return (await db.pubkeys.get(pubkey)) || { ...createPubKeyInfo(pubkey), relays_info: {} };
		});
	}
}
export default QueryCentreInternal;
