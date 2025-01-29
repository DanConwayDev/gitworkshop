import { naddrEncode } from 'nostr-tools/nip19';
import type { Naddr, RepoRef, RepoTableItem } from './types';
import { repo_kind } from './kinds';

export function repoToNaddr(repo: RepoTableItem): Naddr {
	return naddrEncode({
		kind: repo_kind,
		identifier: repo.identifier,
		pubkey: repo.author,
		// TODO: select best relay instead of first one listed in Ann event
		relays: repo.relays && repo.relays.length > 0 ? [repo.relays[0]] : undefined
	});
}

export function repoToRepoRef(repo: RepoTableItem): RepoRef {
	return `${repo_kind}:${repo.author}:${repo.identifier}`;
}
