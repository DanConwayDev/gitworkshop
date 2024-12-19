import { type ProfileContent } from 'applesauce-core/helpers';
import { type Event } from 'nostr-tools';
import { type AddressPointer } from 'nostr-tools/nip19';

export type WebSocketUrl = `wss://${string}` | `ws://${string}`;

export type AtLeastThreeArray<T> = [T, T, T, ...T[]];
export type PubKeyString = string;
export type Npub = `npub1${string}`;
type Timestamp = number;
type Kind = number;
export type EventIdString = string;
export type ARef = `${number}:${PubKeyString}:${string}`;

interface RepoAnnBaseFields {
	identifier: string;
	unique_commit: string | undefined;
	name: string;
	description: string;
	clone: string[];
	web: string[];
	tags: string[];
	maintainers: PubKeyString[];
	relays: string[];
}

interface EventAttribution {
	uuid: EventIdString | ARef;
	event_id: EventIdString | undefined; // used if uuid is ARef
	author: PubKeyString;
	created_at: Timestamp;
}

export interface RepoAnn extends RepoAnnBaseFields, EventAttribution {}

export interface RepoAnnCollection extends RepoAnnBaseFields, EventAttribution {
	trusted_maintainer: string;
	trusted_maintainer_event_id: EventIdString;
	trusted_maintainer_event_created_at: Timestamp;
	// maintainers: string[] recursive maintainers
}

export type RepoSummarisable = (RepoAnn | AddressPointer | RepoAnnCollection) &
	Partial<SeenOn & WithNaddr>;

export type Naddr = `naddr1${string}`;

export type SelectedRepoCollection =
	| (RepoAnnCollection & WithNaddr)
	| (AddressPointer & AndLoading & WithNaddr)
	| undefined;

interface EventRefBase extends EventAttribution {
	kind: Kind;
	parent_ids: (EventIdString | ARef)[];
}

export interface SeenOnRelay {
	/// last successful check completed timestamp | 0
	last_check: Timestamp;
	/// in progress start timestamp so we dont assume every check was successful
	check_initiated_at: Timestamp | undefined;
	seen: boolean | undefined;
	up_to_date: boolean | undefined;
	// for Repos children are PR and issues and for pubkeys they are repo events, Pr and Issues
	last_children_check: Timestamp;
	children_check_initiated_at: Timestamp | undefined;
	hints: RelayHint[];
}

interface RelayHint {
	author: PubKeyString;
	event_id: EventIdString;
	created_at: Timestamp;
}

export const seen_on_relay_defaults: SeenOnRelay = {
	last_check: 0,
	check_initiated_at: undefined,
	seen: undefined,
	up_to_date: undefined,
	last_children_check: 0,
	children_check_initiated_at: undefined,
	hints: []
};

export const extractOrCreateSeenOnRelay = (
	entry: SeenOn | undefined,
	url: WebSocketUrl
): SeenOnRelay => {
	if (entry) {
		const seen_on_relay = entry.seen_on.get(url);
		if (seen_on_relay) return seen_on_relay;
	}
	return { ...seen_on_relay_defaults };
};

export interface SeenOn {
	seen_on: Map<WebSocketUrl, SeenOnRelay>;
}

export interface AndLoading {
	loading: boolean;
}

export interface LastCheck {
	url_and_query: string;
	url: WebSocketUrl;
	timestamp: Timestamp;
	check_initiated_at: Timestamp | undefined;
	query: 'All Repos'; // scope to add other queries eg 'All PRs and Issue' in the future
}

interface PrRevisionRef extends EventRefBase {
	revision_parent_pr: EventIdString;
}

interface PrRevisionRef extends EventRefBase {
	revision_parent_pr: EventIdString;
}

type EventRef = EventRefBase | PrRevisionRef;

export interface WithNaddr {
	naddr: Naddr;
}

enum IssueOrPrStatus {
	Open = 1630,
	Applied = 1631,
	Closed = 1632,
	Draft = 1633
}

interface StatusRef extends EventAttribution {
	status: IssueOrPrStatus;
}

interface IssueOrPrBase extends EventRefBase {
	title: string;
	descritpion: string;
	revision_parent_pr: EventIdString | undefined;
	event: Event;
}

export interface IssueOrPrWithReferences extends IssueOrPrBase {
	status: IssueOrPrStatus;
	status_refs: StatusRef[];
	thread: EventRef[];
}

interface PubkeyEventStamp {
	event_id: EventIdString;
	created_at: Timestamp;
}

export interface PubKeyMetadataInfo extends SeenOn {
	fields: ProfileContent;
	stamp: PubkeyEventStamp | undefined;
}

export interface PubKeyRelayInfo extends SeenOn {
	read: WebSocketUrl[];
	write: WebSocketUrl[];
	relay_hints_found: WebSocketUrl[];
	stamp: PubkeyEventStamp | undefined;
}
export interface PubKeyInfo {
	pubkey: PubKeyString;
	npub: Npub;
	metadata: PubKeyMetadataInfo;
	relays: PubKeyRelayInfo;
}
