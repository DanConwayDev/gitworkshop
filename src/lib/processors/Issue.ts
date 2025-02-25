import {
	getDefaultHuristicsForRelay,
	isRelayCheck,
	isRelayCheckFound,
	isRelayUpdateIssue,
	isRelayUpdateIssueFound,
	IssueOrPrStatus
} from '$lib/types';
import { IssueKind, StatusKinds, StatusOpenKind, RepoAnnKind } from '$lib/kinds';
import type {
	ChildEventRef,
	EventIdString,
	HuristicsForRelay,
	Issue,
	IssueOrPrBase,
	IssueOrPRTableItem,
	PubKeyString,
	RelayCheck,
	RelayCheckFound,
	RelayUpdateIssue,
	RepoRef,
	StatusHistoryItem,
	WithEvent
} from '$lib/types';
import { getValueOfEachTagOccurence } from '$lib/utils';
import { unixNow } from 'applesauce-core/helpers';
import { calculateRelayScore } from '$lib/relay/RelaySelection';
import {
	isProcessorIssueUpdate,
	type DbItemsCollection,
	type ProcessorIssueUpdate,
	type UpdateProcessor
} from '$lib/types/processor';
import type { NostrEvent } from 'nostr-tools';
import {
	eventToQualityChild,
	eventToStatusHistoryItem,
	extractIssueDescription,
	extractIssueTitle,
	extractRootIdIfNonReplaceable
} from '$lib/git-utils';

const processIssueUpdates: UpdateProcessor = (items, updates) => {
	return updates.filter((u) => {
		if (!isProcessorIssueUpdate(u)) return true;
		const uuid = getIssueId(u);
		// drop update with no uuid as it will never process correctly
		if (!uuid) return false;
		const item = items.issues.get(uuid);
		let base_issue;
		if (u.event) {
			base_issue = eventToIssue(u.event);
		}
		const status_item = eventToStatusHistoryItem(u.event);
		if (status_item) {
			if (!item) {
				// either, issue hasn't been recieved yet or status applies to a PR
				// retain the update for processing later
				// TODO - we cant just try and process this every <100ms
				return true;
			}
			processNewStatus(item, status_item);
		}
		const quality_child = eventToQualityChild(u.event);
		if (quality_child) {
			if (!item) {
				// either, issue hasn't been recieved yet or quality_child relates to a PR
				// retain the update for processing later
				// TODO - we cant just try and process this every <100ms
				return true;
			}
			processQualityChild(item, quality_child);
		}

		if (!item && !base_issue) {
			// shouldn't get here - are we processing an event kind we shouldnt?
			// retaining anyway
			return true;
		}

		const updated_item = applyHuristicUpdates(
			{
				...(base_issue || {}),
				...(item || {
					relays_info: {}
				}),
				last_activity: Math.max(item?.last_activity ?? 0, u.event ? u.event.created_at : 0)
			} as IssueOrPRTableItem,
			u.relay_updates
		);
		items.issues.set(uuid, updated_item);
		updateRepoMetrics(items, updated_item, 'issues');
		return false;
	});
};

const getIssueId = (u: ProcessorIssueUpdate): EventIdString | undefined => {
	if (u.event) {
		if (u.event.kind === IssueKind) return u.event.id;
		return extractRootIdIfNonReplaceable(u.event);
	} else if (!u.event && u.relay_updates[0]) {
		return u.relay_updates[0].uuid;
	}
};

function applyHuristicUpdates(
	item: IssueOrPRTableItem,
	issue_updates: RelayUpdateIssue[]
): IssueOrPRTableItem {
	issue_updates.forEach((update) => {
		if (!isRelayUpdateIssue(update)) return;
		if (!item.relays_info[update.url])
			item.relays_info[update.url] = {
				...getDefaultHuristicsForRelay()
			};
		const created_at_on_relays = isRelayUpdateIssueFound(update)
			? update.created_at
			: item.relays_info[update.url].huristics.find(isRelayCheckFound)?.created_at;
		const base = {
			type: update.type,
			timestamp: unixNow(),
			kinds: update.kinds,
			up_to_date: !!created_at_on_relays && created_at_on_relays === item.created_at
		};
		const relay_check: RelayCheck = isRelayUpdateIssueFound(update)
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

export function updateRepoMetrics(
	items: DbItemsCollection,
	item: IssueOrPRTableItem,
	type: 'issues' | 'PRs'
) {
	item.repos.forEach((a_ref) => {
		const repo = items.repos.get(a_ref);
		if (!repo) return;
		if (!repo[type]) {
			repo[type] = {
				[IssueOrPrStatus.Open]: [],
				[IssueOrPrStatus.Applied]: [],
				[IssueOrPrStatus.Closed]: [],
				[IssueOrPrStatus.Draft]: []
			};
		}
		if (!repo[type][item.status].includes(item.uuid))
			StatusKinds.forEach((status_kind) => {
				if (!repo[type]) return; // to stop typescript complaining
				const kind = status_kind as IssueOrPrStatus; // to stop typescript complaining
				if (kind === item.status && !item.deleted_ids.includes(item.uuid)) {
					if (!repo[type][kind].includes(item.uuid)) {
						repo[type][kind].push(item.uuid);
					}
				} else {
					repo[type][kind] = repo[type][kind].filter((uuid) => uuid !== item.uuid);
				}
			});
		items.repos.set(a_ref, repo);
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
			(v) =>
				!isRelayCheck(v) ||
				v.type !== relay_check.type ||
				relay_check.kinds.join() !== v.kinds.join()
		),
		relay_check
	];
	relay_info.score = calculateRelayScore(relay_info.huristics, is_repo_relay);
}

const eventToIssueBaseFields = (event: NostrEvent): IssueOrPrBase | undefined => {
	if (event.kind !== IssueKind) return undefined;
	const title = extractIssueTitle(event);
	const description = extractIssueDescription(event);

	const repos = event.tags
		.filter((t) => t[1] && t[0] === 'a' && t[1].startsWith(RepoAnnKind.toString()))
		.map((t) => t[1]) as RepoRef[];

	const tags = getValueOfEachTagOccurence(event.tags, 't');
	return {
		type: 'issue',
		title,
		description,
		status: StatusOpenKind,
		status_history: [],
		deleted_ids: [],
		quality_children: [],
		quality_children_count: 0,
		repos,
		tags
	};
};

export const eventToIssue = (event: NostrEvent): (Issue & WithEvent) | undefined => {
	const base = eventToIssueBaseFields(event);
	if (!base) return undefined;
	return {
		uuid: event.id,
		author: event.pubkey,
		created_at: event.created_at,
		event,
		...base
	};
};

export const processQualityChild = (item: IssueOrPRTableItem, quality_child: ChildEventRef) => {
	if (
		!item.quality_children.some((c) => c.id === quality_child.id) ||
		!item.deleted_ids.includes(quality_child.id)
	) {
		item.quality_children.push(quality_child);
		item.quality_children_count = item.quality_children.length;
	}
};

export const processNewStatus = (item: IssueOrPRTableItem, status_item: StatusHistoryItem) => {
	if (
		item.status_history.some((h) => h.uuid === status_item.uuid) ||
		item.deleted_ids.includes(status_item.uuid)
	)
		return;
	item.status_history.push(status_item);
	item.status = getCurrentStatusFromStatusHistory(item);
};

export const getCurrentStatusFromStatusHistory = (item: IssueOrPRTableItem) => {
	const maintainers = item.repos.map((r) => r.split(':')[1]) as PubKeyString[];
	const authorised = [item.author, ...maintainers];
	const sorted = item.status_history
		.filter((h) => authorised.includes(h.pubkey))
		.sort((a, b) => b.created_at - a.created_at);
	return sorted[0] ? sorted[0].status : IssueOrPrStatus.Open;
};

export default processIssueUpdates;
