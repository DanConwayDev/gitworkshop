import Dexie, { type EntityTable } from 'dexie'
import type {
  IssueOrPrWithReferences,
  LastCheck,
  PubKeyInfo,
  RepoAnn,
  SeenOn,
} from './types'

export interface SchemaV1 {
  repos: EntityTable<RepoAnn & SeenOn, 'uuid'>
  issues: EntityTable<IssueOrPrWithReferences & SeenOn, 'uuid'>
  prs: EntityTable<IssueOrPrWithReferences & SeenOn, 'uuid'>
  pubkeys: EntityTable<PubKeyInfo, 'pubkey'>
  last_checks: EntityTable<LastCheck, 'url_and_query'>
}

const db = new Dexie('localdb') as Dexie & SchemaV1

db.version(1).stores({
  repos: '&uuid, identifier, author',
  issues: '&uuid, parent_id',
  prs: '&uuid, parent_id',
  pubkeys: '&pubkey',
  last_checks: '&url_and_query',
})

export default db
