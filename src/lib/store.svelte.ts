import {
	type AccountSummary,
	type RepoReadme,
	type RepoRef,
	type RepoRoute,
	type UserRoute
} from './types';

export const search = $state({
	text: ''
});

export const network_status: { offline: boolean } = $state({
	offline: false
});

class Store {
	route?: RepoRoute | UserRoute = $state(undefined);

	logged_in_account?: AccountSummary = $state(undefined);
	accounts: AccountSummary[] = $state([]);

	readme: { [key in RepoRef]: RepoReadme } = $state({});
}

const store = new Store();

export default store;
