/** repo-route types */
import {
	type PubKeyString,
	type Npub,
	type Naddr,
	type Nip05Address,
	isNpub,
	isNaddr,
	isNip05
} from '$lib/types';
import { nip19 } from 'nostr-tools';

export type RepoRouteType = 'npub' | 'naddr' | 'nip05';

export type RepoRoute = RepoRouteNpub | RepoRouteNaddr | RepoRouteNip05;

interface RepoRouteNpub {
	type: 'npub';
	identifier: string;
	pubkey: PubKeyString;
	relays?: string[];
}

interface RepoRouteNaddr {
	type: 'naddr';
	identifier: string;
	pubkey: PubKeyString;
	relays?: string[];
}

interface RepoRouteNip05 {
	type: 'nip05';
	identifier: string;
	nip05: Nip05Address;
	relays?: string[];
}

export type RepoRouteString = `${Npub}/${string}` | Naddr | `${Nip05Address}/${string}`;

export const isRepoRouteString = (s: string | undefined): s is RepoRouteString => {
	if (!s) return false;
	if (isNaddr(s)) return true;
	const split = s.split('/');
	if (split.length !== 2 || split[1].length === 0) return false;
	return isNip05(split[0]) || isNpub(split[0]);
};

export const extractRepoRoute = (s: string): RepoRoute | undefined => {
	if (!s) return undefined;
	if (isNaddr(s)) {
		return {
			type: 'naddr',
			...nip19.decode(s).data
		};
	}
	const split = s.split('/');
	if (split.length !== 2 || split[1].length === 0) return undefined;
	if (isNip05(split[0])) {
		return {
			type: 'nip05',
			nip05: split[0],
			identifier: split[1]
		};
	}
	if (isNpub(split[0])) {
		return {
			type: 'npub',
			pubkey: nip19.decode(split[0]).data as string,
			identifier: split[1]
		};
	}
	return undefined;
};
