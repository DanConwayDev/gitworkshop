import { type Event } from 'nostr-tools'
import { writable, type Writable } from 'svelte/store'
import { ensureSelectedRepoCollection } from './repo'
import type {
  ARef,
  EventIdString,
  IssueOrPrWithReferences,
  SeenOn,
} from '$lib/dbs/types'
import { liveQuery } from 'dexie'
import db from '$lib/dbs/LocalDb'

export const selected_issue: Writable<
  (IssueOrPrWithReferences & SeenOn) | undefined
> = writable(undefined)
let selected_issue_id: EventIdString | undefined = undefined
let issue_unsubsriber: (() => void) | undefined = undefined
export const selected_issue_replies: Writable<Event[]> = writable([])

export const ensureIssueFull = (
  a_ref: ARef | undefined,
  issue_id: EventIdString | undefined
) => {
  if (selected_issue_id === issue_id) return undefined
  selected_issue_id = issue_id
  if (issue_unsubsriber) issue_unsubsriber()
  if (a_ref) ensureSelectedRepoCollection(a_ref)

  issue_unsubsriber = liveQuery(() => {
    if (issue_id) return db.issues.get(issue_id)
    return undefined
  }).subscribe((issue) => selected_issue.set(issue)).unsubscribe
}
