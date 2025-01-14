import Dexie from 'dexie';
import type { LocalDbSchema, RepoTableItem } from '$lib/types';

const db = new Dexie('localdb') as Dexie & LocalDbSchema;

db.version(1).stores({
	repos: '&uuid, identifier, author, *searchWords',
	issues: '&uuid, parent_ids',
	prs: '&uuid, parent_ids',
	pubkeys: '&pubkey, verified_nip05.address',
	last_checks: '&url_and_query'
});

// Add hooks that will index "message" for full-text search:
db.repos.hook('creating', function (_primKey, repo_item: RepoTableItem) {
	if (typeof repo_item.identifier == 'string') repo_item.searchWords = getSearchWords(repo_item);
});
db.repos.hook('updating', function (mods, _primKey, repo_item: RepoTableItem) {
	if ('identifier' in mods || 'name' in mods || 'description' in mods)
		return { searchWords: getSearchWords(repo_item) };
	else return { searchWords: repo_item.searchWords };
});
function getSearchWords(repo_item: RepoTableItem) {
	const s = `${repo_item.identifier} ${repo_item.name} ${repo_item.description}`;
	const delimiters = /[;,|.\s\-:/]+/;
	return s.split(delimiters);
}

export default db;
