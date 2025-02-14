import type { NostrEvent } from 'nostr-tools';
import {
	isRelayUpdateIssue,
	isRelayUpdatePR,
	isRelayUpdatePubkey,
	isRelayUpdateRepo,
	type RelayUpdate,
	type RelayUpdateIssue,
	type RelayUpdatePR,
	type RelayUpdateRepoAnn,
	type RelayUpdateUser
} from './relay-checks';
import { Metadata, RelayList } from 'nostr-tools/kinds';
import type { RepoRef } from './git';
import type { EventIdString, PubKeyString } from './general';
import type { IssueOrPRTableItem, PubKeyTableItem, RepoTableItem } from './tables';
import { Issue, Patch, QualityChildKinds, repo_kind, Status } from '$lib/kinds';
import { eventIsPrRoot } from '$lib/utils';

export type UpdateProcessor = (
	existing_items: DbItemsCollection,
	updates: ProcessorUpdate[]
) => ProcessorUpdate[] | Promise<ProcessorUpdate[]>;

export interface DbItemsKeysCollection {
	repos: Set<RepoRef>;
	pubkeys: Set<PubKeyString>;
	issues: Set<EventIdString>;
	prs: Set<EventIdString>;
}

export interface DbItemsCollection {
	repos: Map<RepoRef, RepoTableItem>;
	pubkeys: Map<PubKeyString, PubKeyTableItem>;
	issues: Map<EventIdString, IssueOrPRTableItem>;
	prs: Map<EventIdString, IssueOrPRTableItem>;
}

export interface ProcessorUpdate {
	event: NostrEvent | undefined;
	relay_updates: RelayUpdate[];
}

export interface ProcessorRepoUpdate {
	event: (NostrEvent & { kind: 30617 }) | undefined;
	relay_updates: RelayUpdateRepoAnn[];
}

export const isProcessorRepoUpdate = (u: ProcessorUpdate): u is ProcessorRepoUpdate =>
	(u.event && u.event.kind === repo_kind) ||
	(u.relay_updates.length > 0 && u.relay_updates.every((ru) => isRelayUpdateRepo(ru)));

export interface ProcessorPubkeyUpdate {
	event: (NostrEvent & { kind: Metadata | RelayList }) | undefined;
	relay_updates: RelayUpdateUser[];
}
export const isProcessorPubkeyUpdate = (u: ProcessorUpdate): u is ProcessorPubkeyUpdate =>
	(u.event && [Metadata, RelayList].includes(u.event.kind)) ||
	(u.relay_updates.length > 0 && u.relay_updates.every((ru) => isRelayUpdatePubkey(ru)));

export interface ProcessorIssueUpdate {
	event: (NostrEvent & { kind: Status | Issue | QualityChildKinds}) | undefined;
	relay_updates: RelayUpdateIssue[];
}

export const isProcessorIssueUpdate = (u: ProcessorUpdate): u is ProcessorIssueUpdate =>
	(u.event && [Issue, ...Status, ...QualityChildKinds ].includes(u.event.kind)) ||
	(u.relay_updates.length > 0 && u.relay_updates.every((ru) => isRelayUpdateIssue(ru)));

export interface ProcessorPrUpdate {
	event: (NostrEvent & { kind: Status | Patch | QualityChildKinds }) | undefined;
	relay_updates: RelayUpdatePR[];
}

export const isProcessorPrUpdate = (u: ProcessorUpdate): u is ProcessorPrUpdate =>
	(u.event && [...Status, , ...QualityChildKinds].includes(u.event.kind)) ||
	(u.event && eventIsPrRoot(u.event)) ||
	(u.relay_updates.length > 0 && u.relay_updates.every((ru) => isRelayUpdatePR(ru)));
