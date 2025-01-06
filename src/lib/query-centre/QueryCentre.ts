import type { PubKeyString } from '$lib/types';
import QueryCentreExternal from './QueryCentreExternal';
import QueryCentreInternal from './QueryCentreInternal';

class QueryCentre {
	external = new QueryCentreExternal();
	internal = new QueryCentreInternal();
	fetchAllRepos() {
		this.external.fetchAllRepos();
		return this.internal.fetchAllRepos();
	}
	searchRepoAnns(query: string) {
		this.external.fetchAllRepos();
		return this.internal.searchRepoAnns(query);
	}

	async fetchPubkey(pubkey: PubKeyString) {
		this.external.fetchPubkey(pubkey);
		return this.internal.fetchPubkey(pubkey);
	}

	fetchPubkeyName(pubkey: PubKeyString) {
		const obs = this.internal.fetchPubkey(pubkey);
		setTimeout(
			() =>
				obs
					.subscribe((e) => {
						if (!e.metadata.stamp) {
							this.external.fetchPubkey(pubkey);
						}
					})
					.unsubscribe(),
			// allow time for fetching from db
			10
		);
		return obs;
	}
}

const query_centre = new QueryCentre();
export default query_centre;
