import db from '$lib/dbs/LocalDb';
import { createPubKeyInfo, repoTableItemDefaults, type ARefP, type PubKeyString } from '$lib/types';
import { liveQuery } from 'dexie';

export class QueryCentreInternal {
	fetchAllRepos() {
		return liveQuery(async () => {
			return await db.repos.toArray();
		});
	}
	fetchRepo(a_ref: ARefP) {
		return liveQuery(async () => {
			return (
				(await db.repos.get(a_ref)) || {
					...repoTableItemDefaults(a_ref)
				}
			);
		});
	}
	searchRepoAnns(query: string) {
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
		// using applesauce querystore instead of svelte's liveQuery because we don't to reload on every to every pubkey
		// note: for this to work we will need to ms before update has made its way into the db via processor.
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
