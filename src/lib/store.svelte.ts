import { getRepoRef } from './type-helpers/repo';
import { type PubKeyString, type RepoRef, type RepoRoute, type UserRoute } from './types';

export const search = $state({
	text: ''
});

export const network_status: { offline: boolean } = $state({
	offline: false
});

class Store {
	repo_route?: RepoRoute = $state(undefined);
	user_route?: UserRoute = $state(undefined);
	route_nip05_pubkey?: PubKeyString = $state(undefined);
	route_nip05_pubkey_loading: boolean = $state(false);
	selected_a_ref?: RepoRef = $derived.by(() => {
		if (this.repo_route) {
			if (this.repo_route.type === 'nip05') {
				if (this.route_nip05_pubkey)
					return getRepoRef({
						identifier: this.repo_route.identifier,
						author: this.route_nip05_pubkey
					});
			} else {
				return getRepoRef({
					identifier: this.repo_route.identifier,
					author: this.repo_route.pubkey
				});
			}
		}
		return undefined;
	});
}

const store = new Store();

export default store;
