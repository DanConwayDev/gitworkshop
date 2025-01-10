import db from '$lib/dbs/LocalDb';
import { liveQueryState } from '$lib/helpers.svelte';
import { type Nip05AddressStandardized, type PubKeyString, type RepoRef } from '$lib/types';

export class QueryCentreInternal {
	fetchAllRepos() {
		return liveQueryState(() => db.repos.toArray());
	}

	// if a_ref its not RepoRef it we will just return the undefined
	fetchRepo(a_ref: RepoRef | string) {
		return liveQueryState(() => db.repos.get(a_ref as RepoRef));
	}

	searchRepoAnns(query: string) {
		if (query.length === 0) this.fetchAllRepos();
		return liveQueryState(() =>
			db.repos.where('searchWords').startsWithAnyOfIgnoreCase(query).distinct().toArray()
		);
	}

	fetchPubkey(pubkey: PubKeyString) {
		return liveQueryState(() => db.pubkeys.get(pubkey));
	}

	fetchNip05(nip05: Nip05AddressStandardized) {
		return liveQueryState(() => db.pubkeys.where('verified_nip05.address').equals(nip05).first());
	}
}
export default QueryCentreInternal;
