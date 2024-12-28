import db from '$lib/dbs/LocalDb';
import {
	getDefaultHuristicsForRelay,
	isRelayCheck,
	isRelayUpdateRepoAnn,
	type RepoAnn
} from '$lib/types';
import { repo_kind } from '$lib/kinds';
import type {
	ARef,
	HuristicsForRelay,
	RelayCheck,
	RelayUpdate,
	RepoAnnBaseFields,
	RepoTableItem
} from '$lib/types';
import { getTagMultiValue, getTagValue, getValueOfEachTagOccurence } from '$lib/utils';
import { getEventUID, unixNow } from 'applesauce-core/helpers';
import { nip19, type NostrEvent } from 'nostr-tools';
import { calculateRelayScore } from '$lib/relay/RelaySelection';

async function processRepoAnn(event: NostrEvent | undefined, relay_updates: RelayUpdate[] = []) {
	const relay_ann_updates = relay_updates.filter(isRelayUpdateRepoAnn);
	if ((event && event.kind !== repo_kind) || relay_ann_updates.length === 0) return;

	const entry = await getAndUpdateRepoTableItemOrCreateFromEvent(
		event || relay_ann_updates[0].uuid
	);
	if (!entry) return;

	relay_ann_updates.forEach((update) => {
		if (!isRelayUpdateRepoAnn(update)) return;
		if (!entry.relays_info[update.url])
			entry.relays_info[update.url] = {
				...getDefaultHuristicsForRelay()
			};
		const relay_check: RelayCheck = {
			timestamp: unixNow(),
			is_child_check: false,
			seen: true,
			up_to_date: update.event_id === entry.event_id
		};
		processHuristic(entry.relays_info[update.url], entry.relays.includes(update.url), relay_check);
	});
	await db.repos.put(
		{
			...entry
		},
		entry.uuid
	);
}

/// mutates relay_info to 1) add relay huristic, 2) update score and 3) remove superfluious huristics
function processHuristic(
	relay_info: HuristicsForRelay,
	is_repo_relay: boolean,
	relay_check: RelayCheck
) {
	relay_info.huristics = [
		// remove any older huristics with same indicators
		...relay_info.huristics.filter(
			(v) =>
				!isRelayCheck(v) ||
				!(
					v.is_child_check === relay_check.is_child_check &&
					v.seen === relay_check.seen &&
					v.up_to_date === relay_check.up_to_date
				)
		),
		relay_check
	];
	relay_info.score = calculateRelayScore(relay_info.huristics, is_repo_relay);
}

async function getAndUpdateRepoTableItemOrCreateFromEvent(
	event_or_aref: NostrEvent | ARef
): Promise<RepoTableItem | undefined> {
	const is_aref = isARef(event_or_aref);
	const aref = is_aref ? event_or_aref : (getEventUID(event_or_aref) as ARef);
	const item_from_db = await db.repos.get(aref);
	if (!item_from_db && is_aref) return;
	let repo_ann;
	if (!is_aref) {
		repo_ann = eventToRepoAnn(event_or_aref);
		if (!repo_ann) return;
	}
	if (!item_from_db && !repo_ann) return;
	const entry: RepoTableItem = {
		...(item_from_db || {
			relays_info: {}
		}),
		...(repo_ann || {}),
		last_activity: Math.max(
			item_from_db?.last_activity ?? 0,
			!is_aref ? event_or_aref.created_at : 0
		)
	} as RepoTableItem;
	return entry;
}

function isARef(a: ARef | NostrEvent): a is ARef {
	return typeof a === 'string';
}

const eventToRepoAnnBaseFields = (event: NostrEvent): RepoAnnBaseFields | undefined => {
	if (event.kind !== repo_kind) return undefined;
	const maintainers = [event.pubkey];
	getTagMultiValue(event.tags, 'maintainers')?.forEach((v, i) => {
		if (i > 0 && v !== maintainers[0]) {
			try {
				nip19.npubEncode(v); // will throw if invalid hex pubkey
				maintainers.push(v);
			} catch {
				/* empty */
			}
		}
	});
	const relays: string[] = [];
	getTagMultiValue(event.tags, 'relays')?.forEach((v, i) => {
		if (i > 0) {
			relays.push(v);
		}
	});
	const web: string[] = [];
	getTagMultiValue(event.tags, 'web')?.forEach((v, i) => {
		if (i > 0) {
			web.push(v);
		}
	});
	const clone: string[] = [];
	getTagMultiValue(event.tags, 'clone')?.forEach((v, i) => {
		if (i > 0) {
			clone.push(v);
		}
	});
	const identifier = getTagValue(event.tags, 'd') || '';
	return {
		identifier,
		unique_commit: event.tags.find((t) => t[2] && t[2] === 'euc')?.[1],
		name: getTagValue(event.tags, 'name') || '',
		description: getTagValue(event.tags, 'description') || '',
		clone,
		web,
		tags: getValueOfEachTagOccurence(event.tags, 't'),
		maintainers,
		relays
	};
};

export const eventToRepoAnn = (event: NostrEvent): RepoAnn | undefined => {
	const base = eventToRepoAnnBaseFields(event);
	if (!base) return undefined;
	return {
		uuid: `${repo_kind}:${event.pubkey}:${base.identifier}`,
		event_id: event.id,
		author: event.pubkey,
		created_at: event.created_at,
		...base
	};
};

export default processRepoAnn;
