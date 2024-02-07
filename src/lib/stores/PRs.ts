import { NDKRelaySet, type NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk'
import { writable, type Unsubscriber, type Writable } from 'svelte/store'
import { ndk } from './ndk'
import { isPRStatus, summary_defaults } from '$lib/components/prs/type'
import type { User } from '$lib/components/users/type'
import { ensureUser } from './users'
import type { PRStatus, PRSummaries } from '$lib/components/prs/type'
import { ensureSelectedRepo } from './repo'
import { patch_kind, pr_kind, pr_status_kind, repo_kind } from '$lib/kinds'
import type { Repo } from '$lib/components/repo/type'
import { extractPatchMessage } from '$lib/components/events/content/utils'

export const pr_summaries: Writable<PRSummaries> = writable({
  id: '',
  summaries: [],
  loading: false,
})

let selected_repo_id: string = ''

let authors_unsubscribers: Unsubscriber[] = []

let sub: NDKSubscription

export const ensurePRSummaries = async (repo_id: string) => {
  if (selected_repo_id == repo_id) return
  pr_summaries.set({
    id: repo_id,
    summaries: [],
    loading: repo_id !== '',
  })

  if (sub) sub.stop()
  if (sub_statuses) sub_statuses.stop()
  authors_unsubscribers.forEach((u) => u())
  authors_unsubscribers = []

  selected_repo_id = repo_id

  const repo = await ensureSelectedRepo(repo_id)

  sub = ndk.subscribe(
    [
      {
        kinds: [pr_kind],
        '#a': repo.maintainers.map(
          (m) => `${repo_kind}:${m.hexpubkey}:${repo.repo_id}`
        ),
        limit: 50,
      },
      {
        kinds: [patch_kind],
        '#a': repo.maintainers.map(
          (m) => `${repo_kind}:${m.hexpubkey}:${repo.repo_id}`
        ),
        limit: 50,
      },
    ],
    {
      closeOnEose: true,
    },
    repo.relays.length > 0
      ? NDKRelaySet.fromRelayUrls(repo.relays, ndk)
      : undefined
  )

  sub.on('event', (event: NDKEvent) => {
    try {
      if (event.kind == patch_kind && event.content.length > 0) {
        pr_summaries.update((prs) => {
          return {
            ...prs,
            summaries: [
              ...prs.summaries,
              {
                ...summary_defaults,
                id: event.id,
                repo_id: repo_id,
                title: extractPatchMessage(event.content) || '',
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
            ],
          }
        })
      }
      if (event.kind == pr_kind) {
        pr_summaries.update((prs) => {
          return {
            ...prs,
            summaries: [
              ...prs.summaries,
              {
                ...summary_defaults,
                id: event.id,
                repo_id: repo_id,
                title: event.tagValue('name') || '',
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
            ],
          }
        })
      }

      authors_unsubscribers.push(
        ensureUser(event.pubkey).subscribe((u: User) => {
          pr_summaries.update((prs) => {
            return {
              ...prs,
              summaries: prs.summaries.map((o) => ({
                ...o,
                author: event.pubkey === o.author.hexpubkey ? u : o.author,
              })),
            }
          })
        })
      )
    } catch {}
  })
  sub.on('eose', () => {
    pr_summaries.update((prs) => {
      getAndUpdatePRStatus(prs, repo)
      return {
        ...prs,
        loading: false,
      }
    })
  })
}

let sub_statuses: NDKSubscription

function getAndUpdatePRStatus(prs: PRSummaries, repo: Repo): void {
  if (sub_statuses) sub_statuses.stop()
  sub_statuses = ndk.subscribe(
    {
      kinds: [pr_status_kind],
      '#e': prs.summaries.map((pr) => pr.id),
      '#r': [`r-${prs.id}`],
    },
    {
      closeOnEose: false,
    },
    NDKRelaySet.fromRelayUrls(repo.relays, ndk)
  )
  sub_statuses.on('event', (event: NDKEvent) => {
    const tagged_pr_event = event.tagValue('e')
    if (
      event.kind == pr_status_kind &&
      tagged_pr_event &&
      event.created_at &&
      event.getMatchingTags('l').length === 1 &&
      event.getMatchingTags('l')[0].length > 1
    ) {
      const potential_status = event.getMatchingTags('l')[0][1]

      if (isPRStatus(potential_status)) {
        pr_summaries.update((prs) => {
          return {
            ...prs,
            summaries: prs.summaries.map((o) => {
              if (
                o.id === tagged_pr_event &&
                event.created_at &&
                o.status_date < event.created_at
              ) {
                return {
                  ...o,
                  status: potential_status as PRStatus,
                  status_date: event.created_at,
                }
              }

              return o
            }),
          }
        })
      }
    }
  })

  sub_statuses.on('eose', () => {
    pr_summaries.update((prs) => {
      return {
        ...prs,
        summaries: prs.summaries.map((o) => ({
          ...o,
          status: o.status || 'Open',
        })),
      }
    })
  })
}
