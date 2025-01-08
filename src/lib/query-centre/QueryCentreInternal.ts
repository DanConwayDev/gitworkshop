import db from '$lib/dbs/LocalDb';
import {
	createPubKeyInfo,
	isRepoRef,
	repoTableItemDefaults,
	type Nip05AddressStandardized,
	type PubKeyString,
	type RepoRef
} from '$lib/types';
import { liveQuery } from 'dexie';

export class QueryCentreInternal {
	fetchAllRepos() {
		return liveQuery(async () => {
			return await db.repos.toArray();
		});
	}
	fetchRepo(a_ref: RepoRef | string) {
		return liveQuery(async () => {
			if (isRepoRef(a_ref)) {
				const record = await db.repos.get(a_ref);
				if (record) return record;
			}
			return {
				...repoTableItemDefaults(a_ref)
			};
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

	fetchNip05(nip05: Nip05AddressStandardized) {
		return liveQuery(async () => {
			return (
				(await db.pubkeys.where('verified_nip05.address').equals(nip05)) || {
					...createPubKeyInfo(nip05),
					relays_info: {}
				}
			);
		});
	}
}
export default QueryCentreInternal;
