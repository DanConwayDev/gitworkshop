import {
  NDKRelaySet,
  type NDKEvent,
  NDKSubscription,
  type NDKFilter,
} from '@nostr-dev-kit/ndk'
import { writable, type Unsubscriber, type Writable } from 'svelte/store'
import { ndk } from './ndk'
import { summary_defaults } from '$lib/components/prs/type'
import type { User } from '$lib/components/users/type'
import { ensureUser } from './users'
import type { PRSummaries } from '$lib/components/prs/type'
import { ensureSelectedRepo } from './repo'
import {
  patch_kind,
  pr_status_kinds,
  proposal_status_open,
  repo_kind,
} from '$lib/kinds'
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

  const without_root_tag = !repo.unique_commit

  const filter_with_root: NDKFilter = {
    kinds: [patch_kind],
    '#a': repo.maintainers.map(
      (m) => `${repo_kind}:${m.hexpubkey}:${repo.repo_id}`
    ),
    '#t': ['root'],
    limit: 50,
  }

  const filter_without_root: NDKFilter = {
    kinds: [patch_kind],
    '#a': repo.maintainers.map(
      (m) => `${repo_kind}:${m.hexpubkey}:${repo.repo_id}`
    ),
    limit: 50,
  }

  sub = ndk.subscribe(
    [without_root_tag ? filter_without_root : filter_with_root],
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
      kinds: pr_status_kinds,
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
      event.kind &&
      pr_status_kinds.includes(event.kind) &&
      tagged_pr_event &&
      event.created_at
    ) {
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
                status: event.kind as number,
                status_date: event.created_at,
              }
            }

            return o
          }),
        }
      })
    }
  })

  sub_statuses.on('eose', () => {
    pr_summaries.update((prs) => {
      return {
        ...prs,
        summaries: prs.summaries.map((o) => ({
          ...o,
          status: o.status || proposal_status_open,
        })),
      }
    })
  })
}
