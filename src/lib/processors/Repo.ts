import {
	getDefaultHuristicsForRelay,
	isRelayCheck,
	isRelayCheckFound,
	isRelayUpdateRepo,
	isRelayUpdateRepoFound,
	IssueOrPrStatus,
	type RepoAnn
} from '$lib/types';
import { RepoAnnKind } from '$lib/kinds';
import type {
	ARefP,
	HuristicsForRelay,
	IssuesOrPrsByStatus,
	RelayCheck,
	RelayCheckFound,
	RelayUpdateFound,
	RelayUpdateRep,
	RepoAnnBaseFields,
	RepoTableItem
} from '$lib/types';
import { getTagMultiValue, getTagValue, getValueOfEachTagOccurence } from '$lib/utils';
import { getEventUID, unixNow } from 'applesauce-core/helpers';
import { nip19, type NostrEvent } from 'nostr-tools';
import { calculateRelayScore } from '$lib/relay/RelaySelection';
import {
	isProcessorRepoUpdate,
	type ProcessorUpdate,
	type UpdateProcessor
} from '$lib/types/processor';
import db from '$lib/dbs/LocalDb';

const processRepoUpdates: UpdateProcessor = async (items, updates) => {
	const retained_updates: ProcessorUpdate[] = [];

	for (const u of updates) {
		if (!isProcessorRepoUpdate(u)) {
			retained_updates.push(u);
			continue;
		}
		const uuid = u.event ? (getEventUID(u.event) as ARefP) : u.relay_updates[0].uuid;
		const item = items.repos.get(uuid);
		let repo_ann;
		if (u.event) {
			repo_ann = eventToRepoAnn(u.event);
		}
		if (!item && !repo_ann) {
			retained_updates.push(u);
			continue;
		}
		const updated_item = applyHuristicUpdates(
			{
				...(item || {
					relays_info: {},
					// if !item, repo_ann must be RepoAnn
					...(await getPrsAndIssues(repo_ann as RepoAnn))
				}),
				...(repo_ann || {}),
				last_activity: Math.max(item?.last_activity ?? 0, u.event ? u.event.created_at : 0)
			} as RepoTableItem,
			u.relay_updates
		);
		items.repos.set(uuid, updated_item);
	}
	return retained_updates;
};

async function getPrsAndIssues(repo_ann: RepoAnn) {
	const [issues, PRs] = await Promise.all([
		db.issues.where('repos').equals(repo_ann.uuid).toArray(),
		db.prs.where('repos').equals(repo_ann.uuid).toArray()
	]);
	const issues_by_status: IssuesOrPrsByStatus = {
		[IssueOrPrStatus.Open]: [],
		[IssueOrPrStatus.Applied]: [],
		[IssueOrPrStatus.Closed]: [],
		[IssueOrPrStatus.Draft]: []
	};
	issues.forEach((issue) => issues_by_status[issue.status].push(issue.uuid));
	const PRs_by_status: IssuesOrPrsByStatus = {
		[IssueOrPrStatus.Open]: [],
		[IssueOrPrStatus.Applied]: [],
		[IssueOrPrStatus.Closed]: [],
		[IssueOrPrStatus.Draft]: []
	};
	PRs.forEach((pr) => PRs_by_status[pr.status].push(pr.uuid));
	return {
		issues: issues_by_status,
		PRs: PRs_by_status
	};
}

function applyHuristicUpdates(
	item: RepoTableItem,
	relay_ann_updates: RelayUpdateRep[]
): RepoTableItem {
	relay_ann_updates.forEach((update) => {
		if (!isRelayUpdateRepo(update)) return;
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
			kinds: update.kinds,
			up_to_date: !!created_at_on_relays && created_at_on_relays === item.created_at
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
			!!item.relays && item.relays.includes(update.url),
			relay_check
		);
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
			(v) =>
				!isRelayCheck(v) ||
				v.type !== relay_check.type ||
				relay_check.kinds.join('') !== v.kinds.join('')
		),
		relay_check
	];
	relay_info.score = calculateRelayScore(relay_info.huristics, is_repo_relay);
}

const eventToRepoAnnBaseFields = (event: NostrEvent): RepoAnnBaseFields | undefined => {
	if (event.kind !== RepoAnnKind) return undefined;
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
		uuid: `${RepoAnnKind}:${event.pubkey}:${base.identifier}`,
		event_id: event.id,
		author: event.pubkey,
		created_at: event.created_at,
		...base
	};
};

export default processRepoUpdates;
