import { type Event } from 'nostr-tools'
import { writable, type Writable } from 'svelte/store'
import {
  type ProposalFull,
  full_defaults,
} from '$lib/components/proposals/type'

export const selected_proposal_full: Writable<ProposalFull> = writable({
  ...full_defaults,
})

export const selected_proposal_replies: Writable<Event[]> = writable([])

export const ensureProposalFull = (
  repo_a: string,
  proposal_id_or_event: string | Event
) => {
  if (repo_a && proposal_id_or_event) return undefined
  else return undefined
}
