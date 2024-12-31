import Dexie, { type EntityTable } from 'dexie';
import type { IssueOrPRTableItem, LastCheck, PubKeyTableItem, RepoTableItem } from '$lib/types';

export interface SchemaV1 {
	repos: EntityTable<RepoTableItem, 'uuid'>;
	issues: EntityTable<IssueOrPRTableItem, 'uuid'>;
	prs: EntityTable<IssueOrPRTableItem, 'uuid'>;
	pubkeys: EntityTable<PubKeyTableItem, 'pubkey'>;
	last_checks: EntityTable<LastCheck, 'url_and_query'>;
}

const db = new Dexie('localdb') as Dexie & SchemaV1;

db.version(1).stores({
	repos: '&uuid, identifier, author, *searchWords',
	issues: '&uuid, parent_ids',
	prs: '&uuid, parent_ids',
	pubkeys: '&pubkey',
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
