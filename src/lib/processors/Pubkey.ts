import db from '$lib/dbs/LocalDb';
import {
	createPubKeyInfo,
	getDefaultHuristicsForRelay,
	isRelayCheck,
	isRelayCheckFound,
	isRelayUpdatePubkey,
	isRelayUpdatePubkeyFound
} from '$lib/types';
import type {
	ARef,
	HuristicsForRelay,
	PubKeyString,
	PubKeyTableItem,
	RelayCheck,
	RelayCheckFound,
	RelayUpdateUser,
	RelayUpdateFound,
	WebSocketUrl
} from '$lib/types';
import {
	getEventUID,
	getInboxes,
	getOutboxes,
	getProfileContent,
	unixNow
} from 'applesauce-core/helpers';
import { calculateRelayScore } from '$lib/relay/RelaySelection';
import { Metadata, RelayList } from 'nostr-tools/kinds';
import type { ProcessorPubkeyUpdate, ProcessorUpdate } from '$lib/types/processor';

export async function processPubkeyUpdates(updates: ProcessorUpdate[]) {
	const pubkey_updates = updates.filter(
		(u) =>
			!u.event ||
			[Metadata, RelayList].includes(u.event.kind) ||
			u.relay_updates.every((ru) => isRelayUpdatePubkey(ru))
	) as ProcessorPubkeyUpdate[];

	if (pubkey_updates.length === 0) return;

	const updated_entries = await getAndUpdatePubkeyTableItemsOrCreateFromEvent(pubkey_updates);

	if (updated_entries.length === 0) return;

	await db.pubkeys.bulkPut(updated_entries);
}

/// gets (or creates) and updates item
async function getAndUpdatePubkeyTableItemsOrCreateFromEvent(
	updates: ProcessorPubkeyUpdate[]
): Promise<PubKeyTableItem[]> {
	const pubkeys: Set<PubKeyString> = new Set();
	updates.forEach((u) => {
		const uuid = u.event ? (getEventUID(u.event) as ARef) : u.relay_updates[0].uuid;
		return pubkeys.add(uuid.split(':')[1]);
	});
	const items = await db.pubkeys.bulkGet([...pubkeys]);
	const update_items: Map<PubKeyString, PubKeyTableItem> = new Map();
	items.forEach((item) => {
		if (item) update_items.set(item.pubkey, item);
	});
	updates.forEach((u) => {
		const uuid = u.event ? (getEventUID(u.event) as ARef) : u.relay_updates[0].uuid;
		const pubkey = uuid.split(':')[1] as PubKeyString;
		const item = update_items.get(pubkey) || {
			...createPubKeyInfo(pubkey),
			relays_info: {}
		};
		if (u.event) {
			if (u.event.kind === Metadata) {
				try {
					if (!item.metadata.stamp || item.metadata.stamp.created_at < u.event.created_at)
						item.metadata = {
							fields: getProfileContent(u.event),
							stamp: { event_id: u.event.id, created_at: u.event.created_at }
						};
				} catch {
					/* empty */
				}
			} else {
				try {
					if (!item.relays.stamp || item.relays.stamp.created_at < u.event.created_at)
						item.relays = {
							read: getInboxes(u.event) as WebSocketUrl[],
							write: getOutboxes(u.event) as WebSocketUrl[],
							stamp: { event_id: u.event.id, created_at: u.event.created_at }
						};
				} catch {
					/* empty */
				}
			}
		}
		applyHuristicUpdates(item, u.relay_updates);
		update_items.set(pubkey, item);
	});
	return [...update_items.values()];
}

function applyHuristicUpdates(item: PubKeyTableItem, relay_user_update: RelayUpdateUser[]) {
	relay_user_update.forEach((update) => {
		if (!isRelayUpdatePubkey(update)) return;
		if (!item.relays_info[update.url])
			item.relays_info[update.url] = {
				...getDefaultHuristicsForRelay()
			};
		const property = update.uuid.split(':')[0] === Metadata.toString() ? 'metadata' : 'relays';

		const created_at_on_relays = isRelayUpdatePubkeyFound(update)
			? update.created_at
			: item.relays_info[update.url].huristics.find(isRelayCheckFound)?.created_at;
		const base = {
			type: update.type,
			timestamp: unixNow(),
			kind: Number(update.uuid.split(':')[0]),
			up_to_date:
				!!created_at_on_relays &&
				!!item[property].stamp &&
				created_at_on_relays === item[property].stamp.created_at
		};
		const relay_check: RelayCheck =
			base.type === 'found'
				? ({
						...base,
						created_at: (update as RelayUpdateFound).created_at
					} as RelayCheckFound)
				: (base as RelayCheck);
		processHuristic(
			item.relays_info[update.url],
			item.relays.write.includes(update.url),
			relay_check
		);
	});
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

export default processPubkeyUpdates;
