import { type AccountSummary, type RepoRoute, type UserRoute } from './types';

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
}

const store = new Store();

export default store;
