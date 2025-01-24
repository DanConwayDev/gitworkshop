import {
	isRepoRef,
	standardizeNip05,
	type EventIdString,
	type Nip05Address,
	type PubKeyString,
	type RepoRef
} from '$lib/types';
import { isEvent } from 'applesauce-core/helpers';
import memory_db from '$lib/dbs/InMemoryRelay';
import db from '$lib/dbs/LocalDb';
import { inMemoryRelayEvent, inMemoryRelayTimeline, liveQueryState } from '$lib/helpers.svelte';
import { createFetchActionsFilter } from '$lib/relay/filters/actions';
import type { NostrEvent } from 'nostr-tools';
import type { NEventAttributes } from 'nostr-editor';

class QueryCentre {
	external_worker: Worker;

	constructor() {
		this.external_worker = new Worker(new URL('./QueryCentreExternal.ts', import.meta.url), {
			type: 'module'
		});
		this.external_worker.onmessage = (msg: MessageEvent<NostrEvent | unknown>) => {
			try {
				if (isEvent(msg?.data)) {
					memory_db.add(msg.data);
				}
			} catch {
				/* empty */
			}
		};
	}

	fetchAllRepos() {
		this.external_worker.postMessage({ method: 'fetchAllRepos', args: [] });
		return liveQueryState(() => db.repos.toArray());
	}

	awaitExternalWorker<T>(call: { method: string; args: unknown[]; request_identifier?: string }) {
		const c = {
			...call,
			request_identifier: call.request_identifier || JSON.stringify(call)
		};
		return new Promise<T>((r) => {
			const handler = (msg: MessageEvent<{ request_identifier: string; result: T }>) => {
				try {
					if (msg.data.request_identifier === c.request_identifier) {
						this.external_worker.removeEventListener('message', handler);
						r(msg.data.result);
					}
				} catch {
					/* empty */
				}
			};
			this.external_worker.addEventListener('message', handler);
			this.external_worker.postMessage(c);
		});
	}

	fetchRepo(a_ref: RepoRef | string | undefined) {
		let loading = $state(isRepoRef(a_ref));
		if (isRepoRef(a_ref)) {
			this.awaitExternalWorker({ method: 'fetchRepo', args: [a_ref] }).then(() => {
				loading = false;
			});
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

	fetchPubkeyRepos(pubkey: PubKeyString) {
		this.external_worker.postMessage({ method: 'fetchPubkeyRepos', args: [pubkey] });
		return liveQueryState(() => db.repos.where('author').equals(pubkey).toArray());
	}

	fetchIssues(a_ref: RepoRef) {
		return liveQueryState(() => db.issues.where('repos').equals(a_ref).toArray());
	}

	fetchIssue(issue_id: EventIdString) {
		return liveQueryState(() => db.issues.get(issue_id));
	}

	fetchIssueThread(a_ref: RepoRef, issue_id: EventIdString) {
		this.external_worker.postMessage({ method: 'fetchIssueThread', args: [a_ref, issue_id] });
		// dynamically add in all the new replies and tagged events
		return inMemoryRelayTimeline([{ '#e': [issue_id] }]);
	}

	fetchPrs(a_ref: RepoRef) {
		return liveQueryState(() => db.prs.where('repos').equals(a_ref).toArray());
	}

	fetchPr(pr_id: EventIdString) {
		return liveQueryState(() => db.issues.get(pr_id));
	}

	fetchEvent(event_ref: NEventAttributes) {
		this.external_worker.postMessage({ method: 'fetchEvent', args: [event_ref] });
		return inMemoryRelayEvent(event_ref);
	}

	fetchPubkeyName(pubkey: PubKeyString) {
		let loading = $state(true);
		this.awaitExternalWorker({ method: 'fetchPubkeyName', args: [pubkey] }).then(() => {
			loading = false;
		});
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
		this.awaitExternalWorker({ method: 'fetchNip05', args: [standardized_nip05] }).then(() => {
			loading = false;
		});
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
