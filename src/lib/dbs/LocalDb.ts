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
	repos: '&uuid, identifier, author',
	issues: '&uuid, parent_ids',
	prs: '&uuid, parent_ids',
	pubkeys: '&pubkey',
	last_checks: '&url_and_query'
});

export default db;
