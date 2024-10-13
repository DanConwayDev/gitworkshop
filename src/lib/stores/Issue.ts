import { type Event } from 'nostr-tools'
import { writable, type Writable } from 'svelte/store'
import { type IssueFull, full_defaults } from '$lib/components/issues/type'

export const selected_issue_full: Writable<IssueFull> = writable({
  ...full_defaults,
})

export const selected_issue_replies: Writable<Event[]> = writable([])

export const ensureIssueFull = (
  repo_a: string,
  issue_id_or_event: string | Event
) => {
  if (repo_a && issue_id_or_event) return undefined
  else return undefined
}
