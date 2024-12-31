import QueryCentreExternal from './QueryCentreExternal';
import QueryCentreInternal from './QueryCentreInternal';

class QueryCentre {
	external = new QueryCentreExternal();
	internal = new QueryCentreInternal();
	fetchAllRepos() {
		this.external.fetchAllRepos();
		return this.internal.fetchAllRepos();
	}
	searchRepoAnns(query: string) {
		this.external.fetchAllRepos();
		return this.internal.searchRepoAnns(query);
	}
}

const query_centre = new QueryCentre();
export default query_centre;
