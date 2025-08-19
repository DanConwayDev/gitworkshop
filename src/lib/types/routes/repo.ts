/** repo-route types */
import { RepoAnnKind } from '$lib/kinds';
import {
	type PubKeyString,
	type Npub,
	type Naddr,
	type Nip05Address,
	isNpub,
	isNip05,
	type UserRoute,
	type EventBech32,
	type RepoRef,
	isRepoNaddr,
	isNprofile,
	isWebSocketUrl
} from '$lib/types';
import { addressPointerToRepoRef } from '$lib/utils';
import { nip19 } from 'nostr-tools';
import type { ProfilePointer } from 'nostr-tools/nip19';

export type RepoRouteNpubString = `${Npub}/${string}`;
export type RepoRouteNpubRelayHintString =
	| `${Npub}/${string}.${string}/${string}`
	| `${Npub}/${string}%3A%2F%2F${string}/${string}`
	// if called after match function it is urlencoded so may have extra slashes
	| `${Npub}/${string}/${string}`;
export type RepoRouteNip05String = `${Nip05Address}/${string}`;
export type RepoRouteString =
	| RepoRouteNpubString
	| RepoRouteNpubRelayHintString
	| Naddr
	| RepoRouteNip05String;

export const isRepoRouteString = (s: string | undefined): s is RepoRouteString => {
	if (!s) return false;
	if (isRepoNaddr(s)) return true;
	if (isNpubRelayHintIdentifierRepoRoute(s)) return true;
	const split = s.split('/');
	if (split[1] && split[1].length > 0)
		return isNip05(split[0]) || isNpub(split[0]) || isNprofile(split[0]);
	return false;
};

export type RepoRouteType = 'npub' | 'naddr' | 'nip05';

export type RepoRoute = RepoRouteNpub | RepoRouteNaddr | RepoRouteNip05;

export const isRepoRoute = (route?: RepoRoute | UserRoute): route is RepoRoute =>
	!!route && typeof route === 'object' && 'identifier' in route;

export const routeToRepoRef = (route?: RepoRoute | UserRoute): RepoRef | undefined =>
	!!route && typeof route === 'object' && 'a_ref' in route ? route.a_ref : undefined;

interface RepoRouteBase {
	type: RepoRouteType;
	identifier: string;
	relays?: string[];
	s: RepoRouteString;
}

interface RepoRouteNpub extends RepoRouteBase {
	type: 'npub';
	pubkey: PubKeyString;
	relays?: string[];
	a_ref: RepoRef;
}

interface RepoRouteNaddr extends RepoRouteBase {
	type: 'naddr';
	pubkey: PubKeyString;
	a_ref: RepoRef;
}

type RepoRouteNip05 = RepoRouteNip05Found | RepoRouteNip05Base;

interface RepoRouteNip05Base extends RepoRouteBase {
	type: 'nip05';
	nip05: Nip05Address;
	loading: boolean;
}
export interface RepoRouteNip05Found extends RepoRouteNip05Base {
	pubkey: PubKeyString;
	loading: false;
	a_ref: RepoRef;
}

export const extractRepoRoute = (s: RepoRouteString): RepoRoute | undefined => {
	// s was validated with isRepoRouteString(s) during 'match' but now is url decoded so we need to handle relay hints
	// // this is called
	if (isRepoNaddr(s)) {
		const { data } = nip19.decode(s);
		return {
			type: 'naddr',
			s,
			...data,
			a_ref: addressPointerToRepoRef(data)
			// TODO relays
		};
	}
	const split = s.split('/');
	if (isNip05(split[0]) && split[1]) {
		return {
			type: 'nip05',
			s,
			nip05: split[0],
			identifier: split[1],
			loading: false
		};
	}
	if (isNpub(split[0]) && split[1]) {
		const with_hint = parseNpubRelayHintIdentifierRepoRoute(s);
		if (with_hint) return with_hint;
		const pubkey = nip19.decode(split[0]).data as PubKeyString;
		return {
			type: 'npub',
			s,
			pubkey,
			identifier: split[1],
			a_ref: `${RepoAnnKind}:${pubkey}:${split[1]}`
		};
	}
	if (isNprofile(s) && split[1]) {
		const p = nip19.decode(s).data as ProfilePointer;
		return {
			type: 'npub',
			s,
			pubkey: p.pubkey,
			identifier: split[1],
			a_ref: `${RepoAnnKind}:${p.pubkey}:${split[1]}`
		};
	}
	return undefined;
};

/// whats returned by the load function at +layouts.ts at the repo_route level
export type RouteData = RouteDataBase & (RepoRouteData | UserRouteData);

export interface UserRouteData extends RouteDataBase {
	user_route: UserRoute;
}

export const isUserRouteData = (data: RouteData): data is UserRouteData => 'user_route' in data;

export interface RepoRouteData extends RouteDataBase {
	repo_route: RepoRoute;
	with_repo_sidebar: boolean;
	show_sidebar_on_mobile: boolean;
}
export const isRepoRouteData = (data: RouteData): data is RepoRouteData => 'repo_route' in data;

interface RouteDataBase {
	url: string;
}

export interface PrOrIssueRouteData extends RepoRouteData {
	event_ref: EventBech32;
}

const isNpubRelayHintIdentifierRepoRoute = (s: string): boolean => {
	const split = s.split('/');
	return (
		isNpub(split[0]) &&
		// there are always 3 items: npub, hint, identifier
		split.length == 3 &&
		// all relay hints include a dot or encoded ://
		['.', '%3A%2F%2F'].some((s) => split[1].includes(s)) &&
		// potential identifier cannot be a gitworkshop repo page
		!['about', 'actions', 'issues', 'prs'].some((s) => s == split[2])
	);
};

// only called if when original s is valided isNpubRelayHintIdentifierRepoRoute but now called after encodeURIComponent
const parseNpubRelayHintIdentifierRepoRoute = (s: string): RepoRoute | undefined => {
	const split = s.split('/');
	const pubkey = nip19.decode(split[0]).data as PubKeyString;
	const identifier = split[split.length - 1];
	const relay_hint = split.slice(1, split.length - 1).join('/');
	let decoded = decodeURIComponent(relay_hint); // should already be decoded but just for good measure
	if (!decoded.includes('://')) decoded = 'wss://' + decoded;
	if (isWebSocketUrl(decoded))
		return {
			type: 'npub',
			s: s as RepoRouteNpubRelayHintString,
			pubkey,
			identifier,
			a_ref: `${RepoAnnKind}:${pubkey}:${identifier}`,
			relays: isWebSocketUrl(decoded) ? [decoded] : undefined
		};
};
