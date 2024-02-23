import { NDKRelaySet, type NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk'
import { writable, type Unsubscriber, type Writable } from 'svelte/store'
import { ndk } from './ndk'
import type { User } from '$lib/components/users/type'
import { ensureUser } from './users'
import {
  type ProposalFull,
  full_defaults,
} from '$lib/components/proposals/type'
import { proposal_status_kinds, proposal_status_open } from '$lib/kinds'
import { ensureSelectedRepo } from './repo'
import { extractPatchMessage } from '$lib/components/events/content/utils'
import { goto } from '$app/navigation'

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

export const ensureProposalFull = (repo_id: string, proposal_id: string) => {
  if (selected_proposal_id == proposal_id) return
  if (proposal_id == '') {
    selected_proposal_full.set({ ...full_defaults })
    selected_proposal_replies.set([])
    return
  }

  if (sub) sub.stop()
  if (sub_replies) sub_replies.stop()

  selected_proposal_repo_id = repo_id
  selected_proposal_id = proposal_id
  selected_proposal_status_date = 0
  selected_proposal_replies.set([])

  selected_proposal_full.set({
    ...full_defaults,
    summary: {
      ...full_defaults.summary,
      id: proposal_id,
      repo_id: repo_id,
      loading: true,
    },
    loading: true,
  })
  if (proposal_summary_author_unsubsriber) proposal_summary_author_unsubsriber()
  proposal_summary_author_unsubsriber = undefined

  new Promise(async (r) => {
    const repo = await ensureSelectedRepo(repo_id)

    sub = ndk.subscribe(
      {
        ids: [proposal_id],
        limit: 50,
      },
      {
        closeOnEose: true,
      },
      repo.relays.length > 0
        ? NDKRelaySet.fromRelayUrls(repo.relays, ndk)
        : undefined
    )

    sub.on('event', (event: NDKEvent) => {
      try {
        if (event.id == proposal_id) {
          const event_repo_id = event.tagValue('a')?.split(':')[2]
          if (event_repo_id && event_repo_id !== repo_id) {
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
      repo.relays.length > 0
        ? NDKRelaySet.fromRelayUrls(repo.relays, ndk)
        : undefined
    )

    const proposalocess_replies = (event: NDKEvent) => {
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
        return [...replies, event].sort(
          (a, b) => (a.created_at || 0) - (b.created_at || 0)
        )
      })
      if (event.tags.some((t) => t.length > 1 && t[1] === 'revision-root')) {
        const sub_revision_replies = ndk.subscribe(
          {
            ids: [proposal_id],
            limit: 50,
          },
          {
            closeOnEose: true,
          },
          repo.relays.length > 0
            ? NDKRelaySet.fromRelayUrls(repo.relays, ndk)
            : undefined
        )
        sub_revision_replies.on('event', (event: NDKEvent) => {
          proposalocess_replies(event)
        })
      }
    }

    sub_replies.on('event', (event: NDKEvent) => {
      proposalocess_replies(event)
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
