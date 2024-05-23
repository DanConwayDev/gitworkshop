import { NDKRelaySet, NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk'
import { writable, type Writable } from 'svelte/store'
import { base_relays, ndk } from './ndk'
import { type IssueFull, full_defaults } from '$lib/components/issues/type'
import { proposal_status_kinds, proposal_status_open } from '$lib/kinds'
import { awaitSelectedRepoCollection } from './repo'
import {
  extractIssueDescription,
  extractIssueTitle,
} from '$lib/components/events/content/utils'
import { selectRepoFromCollection } from '$lib/components/repo/utils'

export const selected_issue_full: Writable<IssueFull> = writable({
  ...full_defaults,
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let selected_issue_repo_a: string = ''
let selected_issue_id: string = ''

export const selected_issue_replies: Writable<NDKEvent[]> = writable([])

let selected_issue_status_date = 0

let sub: NDKSubscription

let sub_replies: NDKSubscription

const sub_replies_to_replies: NDKSubscription[] = []

export const ensureIssueFull = (
  repo_a: string,
  issue_id_or_event: string | NDKEvent
) => {
  const issue_id =
    typeof issue_id_or_event === 'string'
      ? issue_id_or_event
      : issue_id_or_event.id
  if (selected_issue_id == issue_id) return
  if (issue_id == '') {
    selected_issue_full.set({ ...full_defaults })
    selected_issue_replies.set([])
    return
  }

  if (sub) sub.stop()
  if (sub_replies) sub_replies.stop()
  sub_replies_to_replies.forEach((sub) => sub.stop())

  selected_issue_repo_a = repo_a
  selected_issue_id = issue_id
  selected_issue_status_date = 0
  selected_issue_replies.set([])

  selected_issue_full.set({
    ...full_defaults,
    summary: {
      ...full_defaults.summary,
      id: issue_id,
      repo_a,
      loading: true,
    },
    loading: true,
  })

  new Promise(async (r) => {
    const repo_collection = await awaitSelectedRepoCollection(repo_a)
    const repo = selectRepoFromCollection(repo_collection)
    const relays_to_use =
      repo && repo.relays.length > 3
        ? repo.relays
        : [...base_relays].concat(repo ? repo.relays : [])

    const setEvent = (event: NDKEvent) => {
      try {
        selected_issue_full.update((full) => {
          return {
            ...full,
            issue_event: event,
            summary: {
              ...full.summary,
              title: extractIssueTitle(event.content),
              descritpion: extractIssueDescription(event.content),
              created_at: event.created_at,
              comments: 0,
              author: event.pubkey,
              loading: false,
            },
          }
        })
      } catch {}
    }
    if (typeof issue_id_or_event !== 'string') {
      setEvent(issue_id_or_event)
    } else {
      sub = ndk.subscribe(
        {
          ids: [issue_id],
          limit: 100,
        },
        {
          closeOnEose: false,
        },
        NDKRelaySet.fromRelayUrls(relays_to_use, ndk)
      )

      sub.on('event', (event: NDKEvent) => {
        if (event.id == issue_id) setEvent(event)
      })

      sub.on('eose', () => {
        selected_issue_full.update((full) => {
          const updated = {
            ...full,
            summary: {
              ...full.summary,
              loading: false,
            },
          }
          if (full.loading === false) {
            r({ ...updated })
          }
          return updated
        })
      })
    }

    sub_replies = ndk.subscribe(
      {
        '#e': [issue_id],
      },
      {
        closeOnEose: false,
      },
      NDKRelaySet.fromRelayUrls(relays_to_use, ndk)
    )

    const process_replies = (event: NDKEvent) => {
      const amethyst_draft_kind = 31234
      if (event.kind && event.kind === amethyst_draft_kind) return
      if (
        event.kind &&
        proposal_status_kinds.includes(event.kind) &&
        event.created_at &&
        selected_issue_status_date < event.created_at
      ) {
        selected_issue_status_date = event.created_at
        selected_issue_full.update((full) => {
          return {
            ...full,
            summary: {
              ...full.summary,
              status: event.kind,
              // this wont be 0 as we are ensuring it is not undefined above
              status_date: event.created_at || 0,
            },
          }
        })
      }
      selected_issue_replies.update((replies) => {
        if (!replies.some((e) => e.id === event.id)) {
          const sub_replies_to_reply = ndk.subscribe(
            {
              '#e': [event.id],
            },
            {
              groupable: true,
              groupableDelay: 300,
              closeOnEose: false,
            },
            NDKRelaySet.fromRelayUrls(relays_to_use, ndk)
          )
          sub_replies_to_reply.on('event', (event: NDKEvent) => {
            process_replies(event)
          })
          sub_replies_to_replies.push(sub_replies_to_reply)
          return [...replies, event]
        }
        return [...replies]
      })
    }

    sub_replies.on('event', (event: NDKEvent) => {
      process_replies(event)
    })

    sub_replies.on('eose', () => {
      selected_issue_full.update((full) => {
        const updated = {
          ...full,
          summary: {
            ...full.summary,
            status: full.summary.status || proposal_status_open,
          },
          loading: false,
        }
        if (full.summary.loading === false) {
          r({ ...updated })
        }
        return updated
      })
    })
  })
}
