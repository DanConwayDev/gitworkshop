import db from '$lib/dbs/LocalDb';
import { huristics_for_relay_default, type RepoAnn } from '$lib/types';
import { repo_kind } from '$lib/kinds';
import type {
	ARef,
	HuristicsForRelay,
	RelayCheck,
	RelayUpdateRepoAnn,
	RepoAnnBaseFields,
	RepoTableItem
} from '$lib/types';
import { getTagMultiValue, getTagValue, getValueOfEachTagOccurence } from '$lib/utils';
import { getEventUID, unixNow } from 'applesauce-core/helpers';
import { nip19, type NostrEvent } from 'nostr-tools';
import { calculateRelayScore } from '$lib/relay/RelaySelection';

async function processRepoAnn(
	event: NostrEvent,
	relay_updates?: RelayUpdateRepoAnn[]
): Promise<void>;
async function processRepoAnn(
	event: undefined,
	relay_updates: [RelayUpdateRepoAnn, ...RelayUpdateRepoAnn[]]
): Promise<void>;

async function processRepoAnn(
	event: NostrEvent | undefined,
	relay_updates: RelayUpdateRepoAnn[] = []
) {
	const entry = await getAndUpdateRepoTableItemOrCreateFromEvent(event || relay_updates[0].uuid);
	if (!entry) return;

	relay_updates.forEach((update) => {
		const relay_info: HuristicsForRelay = entry.relays_info.get(update.url) || {
			...huristics_for_relay_default
		};
		const relay_check: RelayCheck = {
			timestamp: unixNow(),
			is_child_check: false,
			seen: true,
			up_to_date: update.event_id === entry.event_id
		};
		relay_info.huristics.push(relay_check);
		relay_info.score = calculateRelayScore(relay_info.huristics, entry.relays.includes(update.url));
		entry.relays_info.set(update.url, relay_info);
	});
	db.repos.put({
		...entry
	});
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
			relays_info: new Map()
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
