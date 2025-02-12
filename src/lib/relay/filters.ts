import { issue_kind, patch_kind, status_kinds, repo_kind, repo_state_kind } from '$lib/kinds';
import type {
	EventIdString,
	PubKeyString,
	RelayCheckTimestamp,
	RepoRef,
	Timestamp
} from '$lib/types';
import { aRefPToAddressPointer } from '$lib/utils';
import type { Filter } from 'nostr-tools';
import { Metadata, RelayList } from 'nostr-tools/kinds';

const replication_delay = 15 * 60; // 900 seconds

export const createPubkeyFiltersGroupedBySince = (
	items: Map<PubKeyString, RelayCheckTimestamp>
) => {
	const authors_unkown_or_unchecked: PubKeyString[] = [];
	let checked: {
		pubkey: PubKeyString;
		last_update: Timestamp;
		check_from: Timestamp;
	}[] = [];

	const filters: (Filter & {
		authors: string[];
	})[] = [];

	// put aside undefined last check for filter without since
	items.forEach((t, pubkey) => {
		if (!t.last_check || !t.last_update) {
			authors_unkown_or_unchecked.push(pubkey);
		} else {
			checked.push({
				pubkey,
				// sometimes replication delay can be shortened
				check_from: Math.max(t.last_check - replication_delay, t.last_update),
				last_update: t.last_update
			});
		}
	});

	// sort earliest first
	checked.sort((a, b) => a.check_from - b.check_from);

	while (checked.length > 0) {
		const entry = checked.shift();
		if (!entry) continue;

		const filter = {
			kinds: [Metadata, RelayList],
			authors: [entry.pubkey],
			since: entry.check_from
		};

		checked = checked.filter((item) => {
			if (item.check_from >= filter.since && item.last_update <= filter.since) {
				filter.authors.push(item.pubkey);
				return false;
			}
			return true;
		});
		filters.push(filter);
	}

	if (authors_unkown_or_unchecked.length > 0) {
		filters.push({
			kinds: [Metadata, RelayList],
			authors: authors_unkown_or_unchecked
		});
	}
	return filters;
};

export const createRepoIdentifierFilters = (
	items: Map<RepoRef, RelayCheckTimestamp> | Set<RepoRef>
) => {
	if (items.size === 0) return [];
	if (items instanceof Set) {
		return [
			{
				kinds: [repo_kind, repo_state_kind],
				'#d': [...items]
			}
		];
	}
	const identifiers = new Map<string, number>();

	items.forEach((t, a_ref) => {
		const identifier = aRefPToAddressPointer(a_ref).identifier;
		const map_entry = identifiers.get(identifier) || 0;
		identifiers.set(
			identifier,
			Math.min(map_entry, t.last_child_check ? t.last_child_check - replication_delay : 0)
		);
	});
	const filters: Filter[] = [];
	identifiers.forEach((since, identifier) => {
		filters.push({
			kinds: [repo_kind, repo_state_kind],
			'#d': [identifier],
			since
		});
	});
	// TODO this could be improved to group by since like we do with pubkeys
	return filters;
};

export const createRepoChildrenFilters = (
	items: Map<RepoRef, RelayCheckTimestamp> | Set<RepoRef>
) => {
	if (items.size === 0) return [];
	if (items instanceof Set) {
		return [
			{
				kinds: [issue_kind, patch_kind, ...status_kinds],
				'#a': [...items]
			}
		];
	}
	const sinces = new Map<number, RepoRef[]>();
	const filters: Filter[] = [];
	items.forEach((t, a_ref) => {
		const since = t.last_child_check ? t.last_child_check - replication_delay : 0;
		const map_item = sinces.get(since) || [];
		map_item.push(a_ref);
		sinces.set(since, map_item);
	});
	sinces.forEach((a_refs, since) => {
		const filter: Filter = {
			kinds: [issue_kind, patch_kind, ...status_kinds],
			'#a': a_refs
		};
		if (since > 0) {
			filter.since = since;
		}
		filters.push(filter);
	});
	return filters;
};

/**
 *
 * @param repo_items just used to create the since timestamps
 * @param children
 * @returns
 */
export const createRepoChildrenStatusFilters = (
	children: Set<EventIdString>,
	repo_timestamps?: Map<RepoRef, RelayCheckTimestamp>
) => {
	if (children.size === 0) return [];
	if (!repo_timestamps) {
		return [
			{
				kinds: [...status_kinds],
				'#e': [...children]
			}
		];
	}
	let earliest_since = 0;

	repo_timestamps.forEach((t) => {
		const since = t.last_child_check ? t.last_child_check - replication_delay : 0;
		if (since > earliest_since) earliest_since = since;
	});

	return [
		{
			kinds: [...status_kinds],
			'#e': [...children],
			since: earliest_since === 0 ? undefined : earliest_since
		}
	];
};
