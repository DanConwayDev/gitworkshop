/** repo-route types */
import { repo_kind } from '$lib/kinds';
import {
	type PubKeyString,
	type Npub,
	type Naddr,
	type Nip05Address,
	isNpub,
	isNaddr,
	isNip05,
	type UserRoute,
	type EventBech32,
	type RepoRef,
	isRepoNaddr
} from '$lib/types';
import { addressPointerToRepoRef } from '$lib/utils';
import { nip19 } from 'nostr-tools';

export type RepoRouteNpubString = `${Npub}/${string}`;
export type RepoRouteNip05String = `${Nip05Address}/${string}`;
export type RepoRouteString = RepoRouteNpubString | Naddr | RepoRouteNip05String;

export const isRepoRouteString = (s: string | undefined): s is RepoRouteString => {
	if (!s) return false;
	if (isRepoNaddr(s)) return true;
	const split = s.split('/');
	if (split.length !== 2 || split[1].length === 0) return false;
	return isNip05(split[0]) || isNpub(split[0]);
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

export const extractRepoRoute = (s: string): RepoRoute | undefined => {
	if (!isRepoRouteString(s)) return;
	if (isNaddr(s)) {
		const { data } = nip19.decode(s);
		return {
			type: 'naddr',
			s,
			...data,
			a_ref: addressPointerToRepoRef(data)
		};
	}
	const split = s.split('/');
	if (split.length !== 2 || split[1].length === 0) return undefined;
	if (isNip05(split[0])) {
		return {
			type: 'nip05',
			s,
			nip05: split[0],
			identifier: split[1],
			loading: false
		};
	}
	if (isNpub(split[0])) {
		const pubkey = nip19.decode(split[0]).data as PubKeyString;
		return {
			type: 'npub',
			s,
			pubkey,
			identifier: split[1],
			a_ref: `${repo_kind}:${pubkey}:${split[1]}`
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
