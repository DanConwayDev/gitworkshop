import {
	getDefaultHuristicsForRelay,
	isEventIdString,
	isRelayCheck,
	isRelayCheckFound,
	isRelayUpdateIssue,
	isRelayUpdateIssueFound,
	IssueOrPrStatus
} from '$lib/types';
import { issue_kind, proposal_status_kinds, proposal_status_open, repo_kind } from '$lib/kinds';
import type {
	EventIdString,
	HuristicsForRelay,
	Issue,
	IssueOrPrBase,
	IssueOrPRTableItem,
	RelayCheck,
	RelayCheckFound,
	RelayUpdateIssue,
	RepoRef,
	WithEvent
} from '$lib/types';
import { getParentUuid, getValueOfEachTagOccurence } from '$lib/utils';
import { unixNow } from 'applesauce-core/helpers';
import { calculateRelayScore } from '$lib/relay/RelaySelection';
import {
	isProcessorIssueUpdate,
	type ProcessorIssueUpdate,
	type UpdateProcessor
} from '$lib/types/processor';
import type { NostrEvent } from 'nostr-tools';
import { extractIssueDescription, extractIssueTitle } from '$lib/git-utils';

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
		if (!item && !base_issue) {
			// TODO this could be status update before the issue has been found
			return true;
		}
		const updated_item = applyHuristicUpdates(
			{
				...(item || {
					relays_info: {}
				}),
				...(base_issue || {}),
				last_activity: Math.max(item?.last_activity ?? 0, u.event ? u.event.created_at : 0)
			} as IssueOrPRTableItem,
			u.relay_updates
		);
		items.issues.set(uuid, updated_item);
		updated_item.repos.forEach((a_ref) => {
			const repo = items.repos.get(a_ref);
			// TODO we should create an RepoTableItem without a event just from a reference
			if (!repo) return;
			if (!repo.issues) {
				repo.issues = {
					[IssueOrPrStatus.Open]: [],
					[IssueOrPrStatus.Applied]: [],
					[IssueOrPrStatus.Closed]: [],
					[IssueOrPrStatus.Draft]: []
				};
			}
			proposal_status_kinds.forEach((status_kind) => {
				if (!repo.issues) return; // to stop typescript complaining
				const kind = status_kind as IssueOrPrStatus; // to stop typescript complaining
				if (kind === updated_item.status && !repo.issues[kind].includes(updated_item.uuid)) {
					repo.issues[kind].push(updated_item.uuid);
				} else {
					repo.issues[kind] = repo.issues[kind].filter((uuid) => uuid !== updated_item.uuid);
				}
			});
		});
		return false;
	});
};

const getIssueId = (u: ProcessorIssueUpdate): EventIdString | undefined => {
	if (u.event) {
		if (u.event && u.event.kind === issue_kind) return u.event.id;
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
	if (event.kind !== issue_kind) return undefined;
	const title = extractIssueTitle(event);
	const description = extractIssueDescription(event);

	const repos = event.tags
		.filter((t) => t[1] && t[0] === 'a' && t[1].startsWith(repo_kind.toString()))
		.map((t) => t[1]) as RepoRef[];

	const tags = getValueOfEachTagOccurence(event.tags, 't');
	return {
		title,
		description,
		status: proposal_status_open,
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

export default processIssueUpdates;
