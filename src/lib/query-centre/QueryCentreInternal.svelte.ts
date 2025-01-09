import db from '$lib/dbs/LocalDb';
import { liveQueryState } from '$lib/helpers.svelte';
import {
	type RepoTableItem,
	type Nip05AddressStandardized,
	type PubKeyString,
	type PubKeyTableItem,
	type RepoRef
} from '$lib/types';

export class QueryCentreInternal {
	fetchAllRepos() {
		return liveQueryState(async () => db.repos.toArray());
	}
	fetchRepo(a_ref: RepoRef | string) {
		return liveQueryState(
			async () => db.repos.get(a_ref as RepoRef), // if its not RepoRef it we will just return the default value
			() => [a_ref]
		);
	}
	searchRepoAnns(query: string) {
		if (query.length === 0) this.fetchAllRepos();
		return liveQueryState<RepoTableItem[]>(
			async () =>
				db.repos.where('searchWords').startsWithAnyOfIgnoreCase(query).distinct().toArray(),
			() => [query]
		);
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
		return liveQueryState<PubKeyTableItem>(
			// async () => db.pubkeys.get(pubkey),
			async () => {
				const record = await db.pubkeys.get(pubkey);
				return record
					? {
							...record,
							metadata: {
								...record.metadata,
								fields: { ...record.metadata.fields }
							}
						}
					: record;
			},
			() => [pubkey]
		);
	}

	fetchNip05(nip05: Nip05AddressStandardized) {
		return liveQueryState<PubKeyTableItem>(
			async () => {
				const records = await db.pubkeys.where('verified_nip05.address').equals(nip05).toArray();
				if (records && records[0]) {
					const record = records[0];
					return {
						...record,
						metadata: {
							...record.metadata,
							fields: { ...record.metadata.fields }
						}
					};
				}
				return undefined;
			},
			() => [nip05]
		);
	}
}
export default QueryCentreInternal;
