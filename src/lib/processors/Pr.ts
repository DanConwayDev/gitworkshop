import {
	getDefaultHuristicsForRelay,
	isEventIdString,
	isRelayCheck,
	isRelayCheckFound,
	isRelayUpdatePR,
	isRelayUpdatePRFound,
	IssueOrPrStatus
} from '$lib/types';
import { patch_kind, status_kinds, status_kind_open, repo_kind } from '$lib/kinds';
import type {
	EventIdString,
	HuristicsForRelay,
	Pr,
	IssueOrPrBase,
	IssueOrPRTableItem,
	RelayCheck,
	RelayCheckFound,
	RelayUpdatePR,
	RepoRef,
	WithEvent
} from '$lib/types';
import { getParentUuid, getValueOfEachTagOccurence } from '$lib/utils';
import { unixNow } from 'applesauce-core/helpers';
import { calculateRelayScore } from '$lib/relay/RelaySelection';
import {
	isProcessorPrUpdate,
	type ProcessorPrUpdate,
	type UpdateProcessor
} from '$lib/types/processor';
import type { NostrEvent } from 'nostr-tools';
import {
	eventToQualityChild,
	eventToStatusHistoryItem,
	extractPatchDescription,
	extractPatchTitle
} from '$lib/git-utils';
import { processNewStatus } from './Issue';

const processPrUpdates: UpdateProcessor = (items, updates) => {
	return updates.filter((u) => {
		if (!isProcessorPrUpdate(u)) return true;
		const uuid = getPrId(u);
		// drop update with no uuid as it will never process correctly
		if (!uuid) return false;
		const item = items.prs.get(uuid);
		let base_pr;
		if (u.event) {
			base_pr = eventToPr(u.event);
		}
		const status_item = eventToStatusHistoryItem(u.event);
		if (status_item) {
			if (!item) {
				// either, PR hasn't been recieved yet or status applies to an Issue
				// retain the update for processing later
				// TODO - we cant just try and process this every <100ms
				return true;
			}
			processNewStatus(item, status_item);
		}
		if (!item && !base_pr) {
			// shouldn't get here - are we processing an event kind we shouldnt?
			// retaining anyway
			return true;
		}

		const quality_child = eventToQualityChild(u.event);
		if (quality_child) {
			if (!item) {
				// either, issue hasn't been recieved yet or quality_child relates to a PR
				// retain the update for processing later
				// TODO - we cant just try and process this every <100ms
				return true;
			}
			if (!item.quality_children.some((c) => c.id === quality_child.id)) {
				item.quality_children.push(quality_child);
				item.quality_children_count = item.quality_children.length;
			}
		}
		
		const updated_item = applyHuristicUpdates(
			{
				...(item || {
					relays_info: {}
				}),
				...(base_pr || {}),
				last_activity: Math.max(item?.last_activity ?? 0, u.event ? u.event.created_at : 0)
			} as IssueOrPRTableItem,
			u.relay_updates
		);
		items.prs.set(uuid, updated_item);
		updated_item.repos.forEach((a_ref) => {
			const repo = items.repos.get(a_ref);
			if (!repo) return;
			if (!repo.PRs) {
				repo.PRs = {
					[IssueOrPrStatus.Open]: [],
					[IssueOrPrStatus.Applied]: [],
					[IssueOrPrStatus.Closed]: [],
					[IssueOrPrStatus.Draft]: []
				};
			}
			status_kinds.forEach((status_kind) => {
				if (!repo.PRs) return; // to stop typescript complaining
				const kind = status_kind as IssueOrPrStatus; // to stop typescript complaining
				if (kind === updated_item.status && !repo.PRs[kind].includes(updated_item.uuid)) {
					repo.PRs[kind].push(updated_item.uuid);
				} else {
					repo.PRs[kind] = repo.PRs[kind].filter((uuid) => uuid !== updated_item.uuid);
				}
			});
		});
		return false;
	});
};

const getPrId = (u: ProcessorPrUpdate): EventIdString | undefined => {
	if (u.event) {
		if (u.event && u.event.kind === patch_kind) return u.event.id;
		// TODO get the root
		else {
			const uuid = getParentUuid(u.event);
			if (uuid && isEventIdString(uuid)) return uuid;
		}
	} else if (!u.event && u.relay_updates[0]) {
		return u.relay_updates[0].uuid;
	}
};

function applyHuristicUpdates(
	item: IssueOrPRTableItem,
	pr_updates: RelayUpdatePR[]
): IssueOrPRTableItem {
	pr_updates.forEach((update) => {
		if (!isRelayUpdatePR(update)) return;
		if (!item.relays_info[update.url])
			item.relays_info[update.url] = {
				...getDefaultHuristicsForRelay()
			};
		const created_at_on_relays = isRelayUpdatePRFound(update)
			? update.created_at
			: item.relays_info[update.url].huristics.find(isRelayCheckFound)?.created_at;
		const base = {
			type: update.type,
			timestamp: unixNow(),
			kinds: update.kinds,
			up_to_date: !!created_at_on_relays && created_at_on_relays === item.created_at
		};
		const relay_check: RelayCheck = isRelayUpdatePRFound(update)
			? ({
					...base,
					created_at: update.created_at
				} as RelayCheckFound)
			: (base as RelayCheck);
		processHuristic(
			item.relays_info[update.url],
			false, // TODO - add repo relays as a parameter
			// !!item.relays && item.relays.includes(update.url),
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
				relay_check.kinds.join() !== v.kinds.join()
		),
		relay_check
	];
	relay_info.score = calculateRelayScore(relay_info.huristics, is_repo_relay);
}

const eventToPrBaseFields = (event: NostrEvent): IssueOrPrBase | undefined => {
	if (event.kind !== patch_kind) return undefined;
	const title = extractPatchTitle(event) ?? '';
	const description = extractPatchDescription(event) ?? '';

	const repos = event.tags
		.filter((t) => t[1] && t[0] === 'a' && t[1].startsWith(repo_kind.toString()))
		.map((t) => t[1]) as RepoRef[];

	const tags = getValueOfEachTagOccurence(event.tags, 't').filter(
		(t) => t !== 'root' && t !== 'revision-root'
	);
	return {
		type: 'pr',
		title,
		description,
		status: status_kind_open,
		status_history: [],
		quality_children: [],
		quality_children_count: 0,
		repos,
		tags
	};
};

export const eventToPr = (event: NostrEvent): (Pr & WithEvent) | undefined => {
	const base = eventToPrBaseFields(event);
	if (!base) return undefined;
	return {
		uuid: event.id,
		author: event.pubkey,
		created_at: event.created_at,
		event,
		...base
	};
};

export default processPrUpdates;
