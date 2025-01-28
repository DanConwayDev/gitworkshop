/** repo-route types */
import { type PubKeyString, type Npub, type Nip05Address, isNpub, isNip05 } from '$lib/types';
import { nip19 } from 'nostr-tools';

export type UserRouteString = `${Npub}` | `${Nip05Address}`;

export const isUserRouteString = (s: string | undefined): s is UserRouteString => {
	if (!s) return false;
	return isNip05(s) || isNpub(s);
};

export type UserRouteType = 'npub' | 'nip05';

export type UserRoute = UserRouteNpub | UserRouteNip05;

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
	return undefined;
};
