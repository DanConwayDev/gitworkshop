import {
	type AccountSummary,
	type RepoReadme,
	type RepoRef,
	type RepoRoute,
	type RepoRouteType,
	type UserRoute
} from './types';

export const search = $state({
	text: ''
});

export const network_status: { offline: boolean } = $state({
	offline: false
});

class Store {
	#stored_url_pref: null | RepoRouteType = $state(localStorage.getItem("url_pref") as RepoRouteType | null);

	get stored_url_pref() {
		return this.#stored_url_pref;
	}
	set stored_url_pref(pref: null | RepoRouteType) {
		if (pref) localStorage.setItem("url_pref", pref);
		else localStorage.removeItem("url_pref");
		this.#stored_url_pref = pref;
	}

	url_pref: 'nip05' | 'npub' | 'naddr' = $derived(this.stored_url_pref || 'nip05');

	route?: RepoRoute | UserRoute = $state(undefined);

	logged_in_account?: AccountSummary = $state(undefined);
	accounts: AccountSummary[] = $state([]);

	readme: { [key in RepoRef]: RepoReadme } = $state({});
}

const store = new Store();


localStorage.getItem('accounts') || '[]';


export default store;
