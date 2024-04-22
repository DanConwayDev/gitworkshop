import { NDKRelaySet, type NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk'
import { writable, type Unsubscriber, type Writable } from 'svelte/store'
import { base_relays, ndk } from './ndk'
import type { User } from '$lib/components/users/type'
import { ensureUser } from './users'
import {
  type ProposalFull,
  full_defaults,
} from '$lib/components/proposals/type'
import { proposal_status_kinds, proposal_status_open } from '$lib/kinds'
import { awaitSelectedRepoCollection } from './repo'
import { extractPatchMessage } from '$lib/components/events/content/utils'
import { goto } from '$app/navigation'
import { selectRepoFromCollection } from '$lib/components/repo/utils'

export const selected_proposal_full: Writable<ProposalFull> = writable({
  ...full_defaults,
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let selected_proposal_repo_id: string = ''
let selected_proposal_id: string = ''
let proposal_summary_author_unsubsriber: Unsubscriber | undefined

export const selected_proposal_replies: Writable<NDKEvent[]> = writable([])

let selected_proposal_status_date = 0

let sub: NDKSubscription

let sub_replies: NDKSubscription

const sub_replies_to_replies: NDKSubscription[] = []

export const ensureProposalFull = (
  repo_identifier: string,
  proposal_id: string
) => {
  if (selected_proposal_id == proposal_id) return
  if (proposal_id == '') {
    selected_proposal_full.set({ ...full_defaults })
    selected_proposal_replies.set([])
    return
  }

  if (sub) sub.stop()
  if (sub_replies) sub_replies.stop()
  sub_replies_to_replies.forEach((sub) => sub.stop())

  selected_proposal_repo_id = repo_identifier
  selected_proposal_id = proposal_id
  selected_proposal_status_date = 0
  selected_proposal_replies.set([])

  selected_proposal_full.set({
    ...full_defaults,
    summary: {
      ...full_defaults.summary,
      id: proposal_id,
      repo_identifier: repo_identifier,
      loading: true,
    },
    loading: true,
  })
  if (proposal_summary_author_unsubsriber) proposal_summary_author_unsubsriber()
  proposal_summary_author_unsubsriber = undefined

  new Promise(async (r) => {
    const repo_collection = await awaitSelectedRepoCollection(repo_identifier)
    const repo = selectRepoFromCollection(repo_collection)
    const relays_to_use =
      repo && repo.relays.length > 3
        ? repo.relays
        : [...base_relays].concat(repo ? repo.relays : [])

    sub = ndk.subscribe(
      {
        ids: [proposal_id],
        limit: 100,
      },
      {
        closeOnEose: true,
      },
      NDKRelaySet.fromRelayUrls(relays_to_use, ndk)
    )

    sub.on('event', (event: NDKEvent) => {
      try {
        if (event.id == proposal_id) {
          const event_repo_id = event.tagValue('a')?.split(':')[2]
          if (event_repo_id && event_repo_id !== repo_identifier) {
            goto(
              `/repo/${encodeURIComponent(event_repo_id)}/proposal/${proposal_id}`
            )
          }
          selected_proposal_full.update((full) => {
            return {
              ...full,
              proposal_event: event,
              summary: {
                ...full.summary,
                title: (
                  event.tagValue('name') ||
                  event.tagValue('description') ||
                  extractPatchMessage(event.content) ||
                  ''
                ).split('\n')[0],
                descritpion: event.tagValue('description') || '',
                created_at: event.created_at,
                comments: 0,
                author: {
                  hexpubkey: event.pubkey,
                  loading: true,
                  npub: '',
                },
                loading: false,
              },
            }
          })

          proposal_summary_author_unsubsriber = ensureUser(
            event.pubkey
          ).subscribe((u: User) => {
            selected_proposal_full.update((full) => {
              return {
                ...full,
                summary: {
                  ...full.summary,
                  author: event.pubkey == u.hexpubkey ? u : full.summary.author,
                },
              }
            })
          })
        }
      } catch {}
    })

    sub.on('eose', () => {
      selected_proposal_full.update((full) => {
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

    sub_replies = ndk.subscribe(
      {
        '#e': [proposal_id],
      },
      {
        closeOnEose: false,
      },
      NDKRelaySet.fromRelayUrls(relays_to_use, ndk)
    )

    const process_replies = (event: NDKEvent) => {
      const amethyst_draft_kind = 31234
      if (event.kind && event.kind === amethyst_draft_kind) return false
      if (
        event.kind &&
        proposal_status_kinds.includes(event.kind) &&
        event.created_at &&
        selected_proposal_status_date < event.created_at
      ) {
        selected_proposal_status_date = event.created_at
        selected_proposal_full.update((full) => {
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
      selected_proposal_replies.update((replies) => {
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
      selected_proposal_full.update((full) => {
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
