import { type RepoRoute, type UserRoute } from './types';

export const search = $state({
	text: ''
});

export const network_status: { offline: boolean } = $state({
	offline: false
});

class Store {
	route?: RepoRoute | UserRoute = $state(undefined);
}

const store = new Store();

export default store;
