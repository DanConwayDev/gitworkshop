import { getEventHash, nip19, type NostrEvent } from 'nostr-tools';
import { getRootUuid, getTagValue } from './utils';
import {
	getIssueOrPrStatus,
	isEventIdString,
	isRepoRef,
	isWebSocketUrl,
	type ChildEventRef,
	type EventIdString,
	type IssueOrPRTableItem,
	type RepoRef,
	type RepoRoute,
	type StatusHistoryItem,
	type WebSocketUrl
} from './types';
import { PrKind, QualityChildKinds } from './kinds';

export const isCoverLetter = (s: string): boolean => {
	return s.indexOf('PATCH 0/') > 0;
};
/** this doesn't work for all patch formats and options */
export const extractPatchMessage = (s: string): string | undefined => {
	try {
		if (isCoverLetter(s)) {
			return s.substring(s.indexOf('] ') + 2);
		}
		const t = s.split('Subject: [')[1].split('] ')[1];

		if (t.split('\n\n---\n ').length > 1) return t.split('\n\n---\n ')[0];
		return t.split('\n\ndiff --git ')[0].split('\n\n ').slice(0, -1).join('');
	} catch {
		return undefined;
	}
};

export const extractPatchTitle = (event: NostrEvent): string | undefined =>
	(
		getTagValue(event.tags, 'name') ??
		getTagValue(event.tags, 'description') ??
		extractPatchTitleFromContent(event.content) ??
		''
	)
		.split('\r')[0]
		.split('\n')[0];

/** this doesn't work for all patch formats and options */
const extractPatchTitleFromContent = (s: string): string | undefined => {
	const msg = extractPatchMessage(s);
	if (!msg) return undefined;
	return msg.split('\n')[0];
};

export const extractPatchDescription = (event: NostrEvent): string | undefined =>
	getTagValue(event.tags, 'description') ?? extractPatchDescriptionFromContent(event.content) ?? '';

/** patch message without first line */
const extractPatchDescriptionFromContent = (s: string): string | undefined => {
	const msg = extractPatchMessage(s);
	if (!msg) return '';
	const i = msg.indexOf('\n');
	if (i === -1) return '';
	return msg.substring(i).trim();
};

export const extractIssueTitle = (event: NostrEvent): string => {
	return getTagValue(event.tags, 'subject') || event.content.split('\n')[0] || '';
};

export const extractIssueDescription = (event: NostrEvent): string =>
	extractIssueDescriptionFromContent(event.content);

const extractIssueDescriptionFromContent = (s: string): string => {
	const split = s.split('\n');
	if (split.length === 0) return '';
	return s.substring(split[0].length) || '';
};

export const repoRouteToNostrUrl = (repo_route: RepoRoute): string => {
	if (repo_route.type === 'nip05') {
		if (repo_route.nip05.includes('@'))
			return `nostr://${repo_route.nip05}/${repo_route.identifier}`;
		else return `nostr://_@${repo_route.nip05}/${repo_route.identifier}`;
	}
	const relay_hint = repo_route?.relays?.[0]
		? `/${encodeURIComponent(repo_route.relays[0].replace('wss://', ''))}`
		: '';
	return `nostr://${nip19.npubEncode(repo_route.pubkey)}${relay_hint}/${repo_route.identifier}`;
};

export const extractRepoRefsFromPrOrIssue = (
	event: NostrEvent
): { a_ref: RepoRef; relays: WebSocketUrl[] }[] =>
	event.tags.flatMap((t) =>
		t[1] && t[0] === 'a' && isRepoRef(t[1])
			? [{ a_ref: t[1], relays: t[2] && isWebSocketUrl(t[2]) ? [t[2]] : [] }]
			: []
	);

export const extractRootIdIfNonReplaceable = (event: NostrEvent) => {
	const root = getRootUuid(event);
	if (root && isEventIdString(root)) return root;
	return undefined;
};

export const eventToStatusHistoryItem = (event?: NostrEvent): StatusHistoryItem | undefined => {
	if (!event) return undefined;
	const status = getIssueOrPrStatus(event.kind);
	if (!status) return undefined;
	const { id, pubkey, created_at } = event;
	return { uuid: id, pubkey, created_at, status };
};

export const eventToQualityChild = (event?: NostrEvent): ChildEventRef | undefined => {
	if (!event || !QualityChildKinds.filter((k) => k !== PrKind).includes(event.kind))
		return undefined;
	const { id, kind, pubkey } = event;
	return { id, kind, pubkey };
};

export const deletionRelatedToIssueOrPrItem = (
	deletion: NostrEvent,
	item: IssueOrPRTableItem
): EventIdString[] => {
	return deletion.tags
		.filter((t) => t.length > 1 && t[0] === 'e')
		.map((t) => t[1])
		.filter(
			(id) =>
				id === item.uuid ||
				item.deleted_ids.includes(id) ||
				item.quality_children.some((c) => c.id === id) ||
				item.status_history.some((h) => h.uuid === id)
		);
};

export const refsToBranches = (refs: string[][]) =>
	refs.filter((r) => r[0].startsWith('refs/heads/')).map((r) => r[0].replace('refs/heads/', ''));
export const refsToTags = (refs: string[][]) =>
	refs
		.filter((r) => r[0].startsWith('refs/tags/'))
		.map((r) => r[0].replace('refs/tags/', ''))
		.sort((a, b) => b.localeCompare(a));

export const hashCloneUrl = (url: string): string => {
	// using nostr-tools sha256 hashing dependancy without a seperate import
	return getEventHash({
		pubkey: '0'.repeat(64),
		kind: 1,
		content: url,
		tags: [],
		created_at: 0
	}).slice(0, 8);
};
