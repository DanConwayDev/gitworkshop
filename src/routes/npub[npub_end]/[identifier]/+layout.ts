import { repo_kind } from '$lib/kinds';
import { isNpub, type RepoRef } from '$lib/types';
import { nip19 } from 'nostr-tools';

export const load = ({ params }: { params: { npub_end: string; identifier: string } }) => {
	let a_ref: RepoRef | undefined = undefined;
	if (params.npub_end) {
		const npub = `npub${params.npub_end}`;
		if (isNpub(npub)) {
			a_ref = `${repo_kind}:${nip19.decode(npub).data}:${params.identifier}`;
		}
	}
	return {
		a_ref
	};
};
