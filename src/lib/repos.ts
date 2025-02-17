import { naddrEncode } from 'nostr-tools/nip19';
import {
	IssueOrPrStatus,
	type EventIdString,
	type Naddr,
	type RepoRef,
	type RepoTableItem
} from './types';
import { RepoAnnKind } from './kinds';

export function repoToNaddr(repo: RepoTableItem): Naddr {
	return naddrEncode({
		kind: RepoAnnKind,
		identifier: repo.identifier,
		pubkey: repo.author,
		// TODO: select best relay instead of first one listed in Ann event
		relays: repo.relays && repo.relays.length > 0 ? [repo.relays[0]] : undefined
	});
}

export function repoToRepoRef(repo: RepoTableItem): RepoRef {
	return `${RepoAnnKind}:${repo.author}:${repo.identifier}`;
}

export function repoToMaintainerRepoRefs(repo: RepoTableItem): Set<RepoRef> {
	const s = new Set<RepoRef>();
	s.add(`${RepoAnnKind}:${repo.author}:${repo.identifier}`);
	repo.maintainers?.forEach((m) => {
		s.add(`${RepoAnnKind}:${m}:${repo.identifier}`);
	});
	return s;
}

export const getIssuesAndPrsIdsFromRepoItem = (repo_item: RepoTableItem) => {
	const s = new Set<EventIdString>();
	(Object.values(IssueOrPrStatus) as IssueOrPrStatus[]).forEach((status) => {
		if (repo_item.PRs)
			repo_item.PRs?.[status as IssueOrPrStatus]?.forEach((id) => {
				s.add(id);
			});
		if (repo_item.issues)
			repo_item.issues?.[status as IssueOrPrStatus]?.forEach((id) => {
				s.add(id);
			});
	});
	return s;
};
