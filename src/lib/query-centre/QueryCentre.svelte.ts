import {
	isRepoRef,
	standardizeNip05,
	type Nip05Address,
	type PubKeyString,
	type RepoRef
} from '$lib/types';
import { isEvent } from 'applesauce-core/helpers';
import memory_db from '$lib/dbs/InMemoryRelay';
import db from '$lib/dbs/LocalDb';
import { inMemoryRelayTimeline, liveQueryState } from '$lib/helpers.svelte';
import {
	isFetchedNip05,
	isFetchedPubkey,
	isFetchedRepo,
	type WorkerMsg
} from '$lib/types/worker-msgs';
import { createFetchActionsFilter } from '$lib/relay/filters/actions';

class QueryCentre {
	external_worker: Worker;

	constructor() {
		this.external_worker = new Worker(new URL('./QueryCentreExternal.ts', import.meta.url), {
			type: 'module'
		});
		this.external_worker.onmessage = (msg: MessageEvent<WorkerMsg>) => {
			const { data } = msg;
			if (!data) {
				// do nothing
			} else if (isEvent(data)) {
				memory_db.add(data);
			}
		};
	}

	fetchAllRepos() {
		this.external_worker.postMessage({ method: 'fetchAllRepos', args: [] });
		return liveQueryState(() => db.repos.toArray());
	}

	fetchRepo(a_ref: RepoRef | string | undefined) {
		let loading = $state(isRepoRef(a_ref));
		if (isRepoRef(a_ref)) {
			const handler = (msg: MessageEvent<WorkerMsg>) => {
				if (msg.data && isFetchedRepo(msg.data) && msg.data.a_ref === a_ref) {
					loading = false;
					this.external_worker.removeEventListener('message', handler);
				}
			};
			this.external_worker.addEventListener('message', handler);
			this.external_worker.postMessage({ method: 'fetchRepo', args: [a_ref] });
		}
		// if a_ref its not RepoRef it we will just return the undefined
		return liveQueryState(
			async () => {
				if (isRepoRef(a_ref)) {
					const r = await db.repos.get(a_ref as RepoRef);
					if (r) return { ...r, loading };
					else return undefined;
				} else return undefined;
			},
			() => [loading]
		);
	}

	searchRepoAnns(query: string) {
		this.external_worker.postMessage({ method: 'fetchAllRepos', args: [] });
		if (query.length === 0) this.fetchAllRepos();
		return liveQueryState(() =>
			db.repos.where('searchWords').startsWithAnyOfIgnoreCase(query).distinct().toArray()
		);
	}

	fetchIssues(a_ref: RepoRef) {
		return liveQueryState(() => db.issues.where('repos').equals(a_ref).toArray());
	}

	fetchPrs(a_ref: RepoRef) {
		return liveQueryState(() => db.prs.where('repos').equals(a_ref).toArray());
	}

	fetchPubkeyName(pubkey: PubKeyString) {
		let loading = $state(true);
		const handler = (msg: MessageEvent<WorkerMsg>) => {
			if (msg.data && isFetchedPubkey(msg.data) && msg.data.pubkey === pubkey) {
				loading = false;
				this.external_worker.removeEventListener('message', handler);
			}
		};
		this.external_worker.addEventListener('message', handler);
		this.external_worker.postMessage({ method: 'fetchPubkeyName', args: [pubkey] });
		// if a_ref its not RepoRef it we will just return the undefined
		return liveQueryState(
			async () => {
				const r = await db.pubkeys.get(pubkey);
				if (r) return { ...r, loading };
				else return undefined;
			},
			() => [loading]
		);
	}

	fetchNip05(nip05: Nip05Address) {
		let loading = $state(true);
		const standardized_nip05 = standardizeNip05(nip05);
		const handler = (msg: MessageEvent<WorkerMsg>) => {
			if (msg.data && isFetchedNip05(msg.data) && msg.data.nip05 === nip05) {
				loading = false;
				this.external_worker.removeEventListener('message', handler);
			}
		};
		this.external_worker.addEventListener('message', handler);
		this.external_worker.postMessage({ method: 'fetchNip05', args: [standardized_nip05] });
		// if a_ref its not RepoRef it we will just return the undefined
		return liveQueryState(
			async () => {
				const r = await db.pubkeys.where('verified_nip05').equals(standardized_nip05).first();
				if (r) return { user: r, loading };
				else return { user: undefined, loading };
			},
			() => [loading]
		);
	}

	fetchActions(a_ref: RepoRef) {
		this.external_worker.postMessage({ method: 'fetchActions', args: [a_ref] });
		return inMemoryRelayTimeline(createFetchActionsFilter(a_ref));
	}
}

const query_centre = new QueryCentre();
export default query_centre;
