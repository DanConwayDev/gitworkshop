import type { NostrEvent } from 'nostr-tools';
import type { RepoRef } from './git';

export type WorkerMsg = NostrEvent | FetchedRepoMsg;

export interface FetchedRepoMsg {
	type: 'fetchedRepo';
	a_ref: RepoRef;
}

export const workerMessageFetchedRepo = (a_ref: RepoRef): FetchedRepoMsg => ({
	type: 'fetchedRepo',
	a_ref
});

export const isFetchedRepo = (msg: WorkerMsg): msg is FetchedRepoMsg =>
	'type' in msg && msg.type === 'fetchedRepo';
