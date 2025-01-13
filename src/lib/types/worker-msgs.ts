import type { NostrEvent } from 'nostr-tools';
import type { RepoRef } from './git';
import type { Nip05AddressStandardized, PubKeyString } from './general';

export type WorkerMsg = NostrEvent | FetchedRepoMsg | FetchedPubkeyMsg | FetchedNip05Msg;

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

export interface FetchedPubkeyMsg {
	type: 'fetchedPubkey';
	pubkey: PubKeyString;
}

export const workerMessageFetchedPubkey = (pubkey: PubKeyString): FetchedPubkeyMsg => ({
	type: 'fetchedPubkey',
	pubkey
});

export const isFetchedPubkey = (msg: WorkerMsg): msg is FetchedPubkeyMsg =>
	'type' in msg && msg.type === 'fetchedPubkey';

export interface FetchedNip05Msg {
	type: 'fetchedNip05';
	nip05: Nip05AddressStandardized;
}

export const workerMessageFetchedNip05 = (nip05: Nip05AddressStandardized): FetchedNip05Msg => ({
	type: 'fetchedNip05',
	nip05
});

export const isFetchedNip05 = (msg: WorkerMsg): msg is FetchedNip05Msg =>
	'type' in msg && msg.type === 'fetchedNip05';
