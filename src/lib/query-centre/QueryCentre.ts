import type { PubKeyString } from '$lib/types';
import { isEvent } from 'applesauce-core/helpers';
import QueryCentreInternal from './QueryCentreInternal';
import memory_db from '$lib/dbs/InMemoryRelay';

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
	searchRepoAnns(query: string) {
		this.external_worker.postMessage({ method: 'fetchAllRepos', args: [] });
		return this.internal.searchRepoAnns(query);
	}

	fetchPubkeyName(pubkey: PubKeyString) {
		this.external_worker.postMessage({ method: 'fetchPubkeyName', args: [pubkey] });
		return this.internal.fetchPubkey(pubkey);
	}
}

const query_centre = new QueryCentre();
export default query_centre;
