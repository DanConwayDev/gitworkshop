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

export const selected_proposal: Writable<
  (IssueOrPrWithReferences & SeenOn) | undefined
> = writable(undefined)
let selected_proposal_id: EventIdString | undefined = undefined
let proposal_unsubsriber: (() => void) | undefined = undefined
export const selected_proposal_replies: Writable<Event[]> = writable([])
let proposal_replies_subsription: ZenObservable.Subscription | undefined =
  undefined

export const ensureProposalFull = async (
  a_ref: ARef | undefined,
  proposal_id: EventIdString | undefined
) => {
  if (selected_proposal_id === proposal_id) return undefined
  selected_proposal_id = proposal_id
  if (proposal_unsubsriber) proposal_unsubsriber()
  if (proposal_replies_subsription) proposal_replies_subsription.unsubscribe()
  if (!proposal_id) return undefined
  if (a_ref) ensureSelectedRepoCollection(a_ref)

  proposal_unsubsriber = liveQuery(async () => {
    if (proposal_id) return await db.prs.get(proposal_id)
    return undefined
  }).subscribe((proposal) => selected_proposal.set(proposal)).unsubscribe

  selected_proposal_replies.set([
    ...memory_db.getEventsForFilter({ '#e': [proposal_id] }),
  ])
  proposal_replies_subsription = memory_db.inserted.subscribe(
    (event: Event) => {
      selected_proposal_replies.update((events) => [...events, event])
    }
  )
}
