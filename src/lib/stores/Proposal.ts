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

export const selected_proposal: Writable<
  (IssueOrPrWithReferences & SeenOn) | undefined
> = writable(undefined)
let selected_proposal_id: EventIdString | undefined = undefined
let proposal_unsubsriber: (() => void) | undefined = undefined
export const selected_proposal_replies: Writable<Event[]> = writable([])

export const ensureProposalFull = (
  a_ref: ARef | undefined,
  proposal_id: EventIdString | undefined
) => {
  if (selected_proposal_id === proposal_id) return undefined
  selected_proposal_id = proposal_id
  if (proposal_unsubsriber) proposal_unsubsriber()
  if (a_ref) ensureSelectedRepoCollection(a_ref)

  proposal_unsubsriber = liveQuery(async () => {
    if (proposal_id) return await db.prs.get(proposal_id)
    return undefined
  }).subscribe((proposal) => selected_proposal.set(proposal)).unsubscribe
}
