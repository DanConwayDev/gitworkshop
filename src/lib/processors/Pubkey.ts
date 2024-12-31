import db from '$lib/dbs/LocalDb';
import {
	createPubKeyInfo,
	getDefaultHuristicsForRelay,
	isRelayCheck,
	isRelayUpdatePubkey
} from '$lib/types';
import type {
	ARef,
	HuristicsForRelay,
	PubKeyString,
	PubKeyTableItem,
	RelayCheck,
	RelayUpdate,
	WebSocketUrl
} from '$lib/types';
import {
	getEventUID,
	getInboxes,
	getOutboxes,
	getProfileContent,
	unixNow
} from 'applesauce-core/helpers';
import { type NostrEvent } from 'nostr-tools';
import { calculateRelayScore } from '$lib/relay/RelaySelection';
import { Metadata, RelayList } from 'nostr-tools/kinds';

async function processPubkey(event: NostrEvent | undefined, relay_updates: RelayUpdate[] = []) {
	const relay_ann_updates = relay_updates.filter(isRelayUpdatePubkey);
	if (!(event && [Metadata, RelayList].includes(event.kind)) || relay_ann_updates.length === 0)
		return;
	const entry = await getAndUpdateOrCreatePubkeyTableItem(event || relay_ann_updates[0].uuid);
	relay_ann_updates.forEach((update) => {
		if (!isRelayUpdatePubkey(update)) return;
		if (!entry.relays_info[update.url])
			entry.relays_info[update.url] = {
				...getDefaultHuristicsForRelay()
			};
		const type = update.uuid.split(':')[0] === Metadata.toString() ? 'metadata' : 'relays';
		const relay_check: RelayCheck = {
			timestamp: unixNow(),
			is_child_check: false,
			seen: update.type === 'finding' ? undefined : update.type === 'found',
			up_to_date:
				!!update.event_id &&
				(!entry[type].stamp ||
					!entry[type].stamp.event_id ||
					update.event_id === entry[type].stamp.event_id)
		};
		processHuristic(
			entry.relays_info[update.url],
			entry.relays.write.includes(update.url),
			relay_check
		);
	});
	await db.pubkeys.put(
		{
			...entry
		},
		entry.pubkey
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

async function getAndUpdateOrCreatePubkeyTableItem(
	event_or_aref: NostrEvent | ARef
): Promise<PubKeyTableItem> {
	const is_aref = isARef(event_or_aref);
	const aref = is_aref ? event_or_aref : (getEventUID(event_or_aref) as ARef);
	const pubkey = aref.split(':')[1] as PubKeyString;
	const item = (await db.pubkeys.get(pubkey)) || {
		...createPubKeyInfo(pubkey),
		relays_info: {}
	};
	if (!is_aref) {
		if (aref.split(':')[0] === Metadata.toString()) {
			try {
				if (!item.metadata.stamp || item.metadata.stamp.created_at < event_or_aref.created_at)
					item.metadata = {
						fields: getProfileContent(event_or_aref),
						stamp: { event_id: event_or_aref.id, created_at: event_or_aref.created_at }
					};
			} catch {
				/* empty */
			}
		} else {
			try {
				if (!item.relays.stamp || item.relays.stamp.created_at < event_or_aref.created_at)
					item.relays = {
						read: getInboxes(event_or_aref) as WebSocketUrl[],
						write: getOutboxes(event_or_aref) as WebSocketUrl[],
						stamp: { event_id: event_or_aref.id, created_at: event_or_aref.created_at }
					};
			} catch {
				/* empty */
			}
		}
	}
	return item;
}

function isARef(a: ARef | NostrEvent): a is ARef {
	return typeof a === 'string';
}

export default processPubkey;
