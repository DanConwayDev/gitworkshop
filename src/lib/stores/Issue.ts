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
import memory_db from '$lib/dbs/InMemoryRelay'

export const selected_issue: Writable<
  (IssueOrPrWithReferences & SeenOn) | undefined
> = writable(undefined)
let selected_issue_id: EventIdString | undefined = undefined
let issue_unsubsriber: (() => void) | undefined = undefined
export const selected_issue_replies: Writable<Event[]> = writable([])
let issue_replies_unsubsriber: (() => void) | undefined = undefined

export const ensureIssueFull = (
  a_ref: ARef | undefined,
  issue_id: EventIdString | undefined
) => {
  if (selected_issue_id === issue_id) return undefined
  selected_issue_id = issue_id
  if (issue_unsubsriber) issue_unsubsriber()
  if (issue_replies_unsubsriber) issue_replies_unsubsriber()
  if (!issue_id) return undefined
  if (a_ref) ensureSelectedRepoCollection(a_ref)

  issue_unsubsriber = liveQuery(async () => {
    if (issue_id) return await db.issues.get(issue_id)
    return undefined
  }).subscribe((issue) => selected_issue.set(issue)).unsubscribe

  selected_issue_replies.set([
    ...memory_db.getEventsForFilter({ '#e': [issue_id] }),
  ])
  issue_replies_unsubsriber = memory_db.inserted.subscribe((event: Event) => {
    selected_issue_replies.update((events) => [...events, event])
  }).unsubscribe
}
