import db from '$lib/dbs/LocalDb';
import { extractOrCreateSeenOnRelay, type RepoAnn, type WebSocketUrl } from '$lib/dbs/types';
import { repo_kind } from '$lib/kinds';
import { getTagMultiValue, getTagValue, getValueOfEachTagOccurence } from '$lib/utils';
import { getSeenRelays, safeRelayUrls, unixNow } from 'applesauce-core/helpers';
import { nip19, type NostrEvent } from 'nostr-tools';

async function processRepoAnn(event: NostrEvent) {
	const repo_ann = eventToRepoAnn(event);
	if (!repo_ann) return;

	const original = await db.repos.get(repo_ann.uuid);
	const seen_on = original ? original.seen_on : new Map();
	const up_to_date =
		!original ||
		original.event_id == repo_ann.event_id ||
		original.created_at < repo_ann.created_at;
	for (const relay_url of safeRelayUrls(getSeenRelays(event) || []) as WebSocketUrl[]) {
		const seen_on_relay = {
			...extractOrCreateSeenOnRelay(original, relay_url),
			last_check: unixNow(),
			seen: true,
			up_to_date
		};
		seen_on.set(relay_url, seen_on_relay);
	}
	db.repos.put({
		...(!original || up_to_date ? repo_ann : original),
		seen_on
	});
}

export const eventToRepoAnn = (event: NostrEvent): RepoAnn | undefined => {
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
		uuid: `${repo_kind}:${event.pubkey}:${identifier}`,
		event_id: event.id,
		author: event.pubkey,
		identifier,
		unique_commit: event.tags.find((t) => t[2] && t[2] === 'euc')?.[1],
		name: getTagValue(event.tags, 'name') || '',
		description: getTagValue(event.tags, 'description') || '',
		clone,
		web,
		tags: getValueOfEachTagOccurence(event.tags, 't'),
		maintainers,
		relays,
		created_at: event.created_at
	};
};

export default processRepoAnn;
