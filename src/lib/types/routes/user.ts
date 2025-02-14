/** repo-route types */
import {
	type PubKeyString,
	type Npub,
	type Nip05Address,
	isNpub,
	isNip05,
	type RepoRoute,
	isNprofile
} from '$lib/types';
import { nip19 } from 'nostr-tools';
import type { ProfilePointer } from 'nostr-tools/nip19';

export type UserRouteString = `${Npub}` | `${Nip05Address}`;

export const isUserRouteString = (s: string | undefined): s is UserRouteString => {
	if (!s) return false;
	return isNip05(s) || isNpub(s) || isNprofile(s);
};

export type UserRouteType = 'npub' | 'nip05';

export type UserRoute = UserRouteNpub | UserRouteNip05;

export const isUserRoute = (route?: RepoRoute | UserRoute): route is UserRoute =>
	!!route && typeof route === 'object' && !('identifier' in route);

interface UserRouteBase {
	type: UserRouteType;
	relays?: string[];
	s: UserRouteString;
}

interface UserRouteNpub extends UserRouteBase {
	type: 'npub';
	pubkey: PubKeyString;
}

type UserRouteNip05 = UserRouteNip05Base | UserRouteNip05Found;
interface UserRouteNip05Base extends UserRouteBase {
	type: 'nip05';
	nip05: Nip05Address;
	loading: boolean;
}

interface UserRouteNip05Found extends UserRouteNip05Base {
	type: 'nip05';
	nip05: Nip05Address;
	loading: false;
	pubkey: PubKeyString;
}

export const extractUserRoute = (s: string): UserRoute | undefined => {
	if (!isUserRouteString(s)) return;
	if (isNip05(s)) {
		return {
			type: 'nip05',
			s,
			nip05: s,
			loading: false
		};
	}
	if (isNpub(s)) {
		return {
			type: 'npub',
			s,
			pubkey: nip19.decode(s).data as string
		};
	}
	if (isNprofile(s)) {
		let p = nip19.decode(s).data as ProfilePointer;
		return {
			type: 'npub',
			s,
			pubkey: p.pubkey
			// relays: TODO
		};
	}

	return undefined;
};
