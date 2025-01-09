import {
	isRepoRef,
	standardizeNip05,
	type Nip05Address,
	type PubKeyString,
	type RepoRef
} from '$lib/types';
import { isEvent } from 'applesauce-core/helpers';
import memory_db from '$lib/dbs/InMemoryRelay';
import QueryCentreInternal from './QueryCentreInternal.svelte';

class QueryCentre {
	internal = new QueryCentreInternal();
	external_worker: Worker;

	constructor() {
		this.external_worker = new Worker(new URL('./QueryCentreExternal.ts', import.meta.url), {
			type: 'module'
		});
		this.external_worker.onmessage = (msg: MessageEvent) => {
			if (isEvent(msg)) {
				memory_db.add(msg);
			}
		};
	}

	fetchAllRepos() {
		this.external_worker.postMessage({ method: 'fetchAllRepos', args: [] });
		return this.internal.fetchAllRepos();
	}
	fetchRepo(a_ref: RepoRef | string) {
		if (isRepoRef(a_ref)) this.external_worker.postMessage({ method: 'fetchRepo', args: [a_ref] });
		return this.internal.fetchRepo(a_ref);
	}
	searchRepoAnns(query: string) {
		this.external_worker.postMessage({ method: 'fetchAllRepos', args: [] });
		return this.internal.searchRepoAnns(query);
	}

	fetchPubkeyName(pubkey: PubKeyString) {
		this.external_worker.postMessage({ method: 'fetchPubkeyName', args: [pubkey] });
		return this.internal.fetchPubkey(pubkey);
	}

	fetchNip05(nip05: Nip05Address) {
		const standardized_nip05 = standardizeNip05(nip05);
		this.external_worker.postMessage({ method: 'fetchNip05', args: [standardized_nip05] });
		return this.internal.fetchNip05(standardized_nip05);
	}
}

const query_centre = new QueryCentre();
export default query_centre;
