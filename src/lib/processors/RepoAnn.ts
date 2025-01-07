import db from '$lib/dbs/LocalDb';
import {
	getDefaultHuristicsForRelay,
	isRelayCheck,
	isRelayCheckFound,
	isRelayUpdateRepoAnn,
	isRelayUpdateRepoFound,
	type RepoAnn
} from '$lib/types';
import { repo_kind } from '$lib/kinds';
import type {
	ARef,
	HuristicsForRelay,
	RelayCheck,
	RelayCheckFound,
	RelayUpdateFound,
	RelayUpdateRepoAnn,
	RepoAnnBaseFields,
	RepoTableItem
} from '$lib/types';
import { getTagMultiValue, getTagValue, getValueOfEachTagOccurence } from '$lib/utils';
import { getEventUID, unixNow } from 'applesauce-core/helpers';
import { nip19, type NostrEvent } from 'nostr-tools';
import { calculateRelayScore } from '$lib/relay/RelaySelection';
import type { ProcessorRepoUpdate, ProcessorUpdate } from '$lib/types/processor';

export async function processRepoAnnUpdates(updates: ProcessorUpdate[]) {
	const repo_updates = updates.filter(
		(u) =>
			!u.event ||
			u.event.kind === repo_kind ||
			u.relay_updates.every((ru) => isRelayUpdateRepoAnn(ru))
	) as ProcessorRepoUpdate[];

	if (repo_updates.length === 0) return;

	const updated_entries = await getAndUpdateRepoTableItemsOrCreateFromEvent(repo_updates);

	if (updated_entries.length === 0) return;

	await db.repos.bulkPut(updated_entries);
}

/// gets and updates item, creates new item when event provided and no item exists, ignores if no items and no event
async function getAndUpdateRepoTableItemsOrCreateFromEvent(
	updates: ProcessorRepoUpdate[]
): Promise<RepoTableItem[]> {
	const uuids = updates.map((u) =>
		u.event ? (getEventUID(u.event) as ARef) : u.relay_updates[0].uuid
	);
	const items = await db.repos.bulkGet(uuids);
	return updates
		.map((u) => {
			const uuid = u.event ? (getEventUID(u.event) as ARef) : u.relay_updates[0].uuid;
			const item = items.find((item) => item && item.uuid === uuid);
			let repo_ann;
			if (u.event) {
				repo_ann = eventToRepoAnn(u.event);
			}
			if (!item && !repo_ann) return;
			const updated_item = applyHuristicUpdates(
				{
					...(item || {
						relays_info: {}
					}),
					...(repo_ann || {}),
					last_activity: Math.max(item?.last_activity ?? 0, u.event ? u.event.created_at : 0)
				} as RepoTableItem,
				u.relay_updates
			);
			return updated_item;
		})
		.filter((u) => !!u);
}

function applyHuristicUpdates(
	item: RepoTableItem,
	relay_ann_updates: RelayUpdateRepoAnn[]
): RepoTableItem {
	relay_ann_updates.forEach((update) => {
		if (!isRelayUpdateRepoAnn(update)) return;
		if (!item.relays_info[update.url])
			item.relays_info[update.url] = {
				...getDefaultHuristicsForRelay()
			};
		const created_at_on_relays = isRelayUpdateRepoFound(update)
			? update.created_at
			: item.relays_info[update.url].huristics.find(isRelayCheckFound)?.created_at;
		const base = {
			type: update.type,
			timestamp: unixNow(),
			kind: Number(update.uuid.split(':')[0]),
			up_to_date: !!created_at_on_relays && created_at_on_relays === item.created_at
		};
		const relay_check: RelayCheck =
			base.type === 'found'
				? ({
						...base,
						created_at: (update as RelayUpdateFound).created_at
					} as RelayCheckFound)
				: (base as RelayCheck);
		processHuristic(item.relays_info[update.url], item.relays.includes(update.url), relay_check);
	});
	return item;
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
			(v) => !isRelayCheck(v) || v.type !== relay_check.type || relay_check.kind !== v.kind
		),
		relay_check
	];
	relay_info.score = calculateRelayScore(relay_info.huristics, is_repo_relay);
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

export default processRepoAnnUpdates;
