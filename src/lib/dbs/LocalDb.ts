import Dexie from 'dexie';
import { IssueOrPrStatus, type LocalDbSchema, type RepoTableItem } from '$lib/types';
import { clearLocalRelayDb } from './LocalRelayDb';

const db = new Dexie('localdb') as Dexie & LocalDbSchema;

db.version(1).stores({
	repos: '&uuid, identifier, author, *searchWords',
	issues: '&uuid, parent_ids, *repos',
	prs: '&uuid, parent_ids, *repos',
	pubkeys: '&pubkey, *verified_nip05',
	last_checks: '&url_and_query',
	outbox: '&event.id'
});

db.version(2)
	.stores({
		repos: '&uuid, identifier, author, *searchWords',
		issues: '&uuid, parent_ids, *repos',
		prs: '&uuid, parent_ids, *repos',
		pubkeys: '&pubkey, *verified_nip05',
		last_checks: '&url_and_query',
		outbox: '&event.id'
	})
	.upgrade(async (tx) => {
		// added deletion support
		// added uuid to status_history
		await Promise.all([
			tx
				.table('issues')
				.toCollection()
				.modify((issue) => {
					// clear relays_info to fetch all replies again
					issue.relays_info = {};
					issue.status_history = [];
					issue.quality_children = [];
					issue.quality_children_count = 0;
					issue.deleted_children_ids = [];
					issue.status = IssueOrPrStatus.Open;
				}),
			tx
				.table('prs')
				.toCollection()
				.modify((pr) => {
					// clear relays_info to fetch all replies again
					pr.relays_info = {};
					pr.status_history = [];
					pr.quality_children = [];
					pr.quality_children_count = 0;
					pr.deleted_children_ids = [];
					pr.status = IssueOrPrStatus.Open;
				}),
			tx
				.table('repos')
				.toCollection()
				.modify((repos) => {
					// clear relays_info to fetch all issues and prs again
					repos.relays_info = {};
				})
		]);
		await clearLocalRelayDb();
	});

// Add hooks that will index "message" for full-text search:
db.repos.hook('creating', function (_primKey, repo_item: RepoTableItem) {
	if (typeof repo_item.identifier == 'string') repo_item.searchWords = getSearchWords(repo_item);
});
db.repos.hook('updating', function (mods, _primKey, repo_item: RepoTableItem) {
	if ('identifier' in mods || 'name' in mods || 'description' in mods || 'tags' in mods)
		return { searchWords: getSearchWords(repo_item) };
	else return { searchWords: repo_item.searchWords };
});
function getSearchWords(repo_item: RepoTableItem) {
	const s = `${repo_item.identifier} ${repo_item.name} ${repo_item.description} ${(repo_item.tags ?? []).join(' ')}`;
	const delimiters = /[;,|.\s\-:/]+/;
	return s.split(delimiters);
}

export default db;
