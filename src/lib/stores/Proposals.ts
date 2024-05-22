import {
  NDKRelaySet,
  type NDKEvent,
  NDKSubscription,
  type NDKFilter,
} from '@nostr-dev-kit/ndk'
import { writable, type Writable } from 'svelte/store'
import { base_relays, ndk } from './ndk'
import { summary_defaults } from '$lib/components/proposals/type'
import type { ProposalSummaries } from '$lib/components/proposals/type'
import { awaitSelectedRepoCollection } from './repo'
import {
  patch_kind,
  proposal_status_kinds,
  proposal_status_open,
  repo_kind,
} from '$lib/kinds'
import { extractPatchMessage } from '$lib/components/events/content/utils'
import { selectRepoFromCollection } from '$lib/components/repo/utils'
import { returnRepoCollection } from './repos'

export const proposal_summaries: Writable<ProposalSummaries> = writable({
  repo_a: '',
  summaries: [],
  loading: false,
})

let selected_a: string | undefined = ''

let sub: NDKSubscription

export const ensureProposalSummaries = async (repo_a: string | undefined) => {
  if (selected_a == repo_a) return
  proposal_summaries.set({
    repo_a,
    summaries: [],
    loading: repo_a !== '',
  })

  if (sub) sub.stop()
  if (sub_statuses) sub_statuses.stop()

  selected_a = repo_a

  setTimeout(() => {
    proposal_summaries.update((summaries) => {
      return {
        ...summaries,
        loading: false,
      }
    })
  }, 6000)

  let relays_to_use = [...base_relays]
  let filter: NDKFilter = {
    kinds: [patch_kind],
    limit: 100,
  }

  if (repo_a) {
    const repo_collection = await awaitSelectedRepoCollection(repo_a)

    const repo = selectRepoFromCollection(repo_collection)
    if (!repo) {
      // TODO: display error info bar
      return
    }

    relays_to_use =
      repo.relays.length > 3
        ? repo.relays
        : [...base_relays].concat(repo.relays)

    const without_root_tag = !repo.unique_commit

    if (without_root_tag) {
      filter = {
        kinds: [patch_kind],
        '#a': repo.maintainers.map(
          (m) => `${repo_kind}:${m}:${repo.identifier}`
        ),
        limit: 100,
      }
    } else {
      filter = {
        kinds: [patch_kind],
        '#a': repo.maintainers.map(
          (m) => `${repo_kind}:${m}:${repo.identifier}`
        ),
        '#t': ['root'],
        limit: 100,
      }
    }
  }

  sub = ndk.subscribe(
    filter,
    {
      closeOnEose: false,
    },
    NDKRelaySet.fromRelayUrls(relays_to_use, ndk)
  )

  sub.on('event', async (event: NDKEvent) => {
    try {
      if (
        event.kind == patch_kind &&
        event.content.length > 0 &&
        !event.tags.some((t) => t.length > 1 && t[1] === 'revision-root')
      ) {
        if (!extractRepoAFromProposalEvent(event) && !repo_a) {
          // link to proposal will not work as it requires an identifier
          return
        }

        proposal_summaries.update((proposals) => {
          return {
            ...proposals,
            summaries: [
              ...proposals.summaries,
              {
                ...summary_defaults,
                id: event.id,
                repo_a: extractRepoAFromProposalEvent(event) || repo_a || '',
                title: (
                  event.tagValue('name') ||
                  event.tagValue('description') ||
                  extractPatchMessage(event.content) ||
                  ''
                ).split('\n')[0],
                descritpion: event.tagValue('description') || '',
                created_at: event.created_at,
                comments: 0,
                author: event.pubkey,
                loading: false,
              },
            ],
          }
        })

        // filter out non root proposals if repo event supports nip34+ features
        if (repo_a && repo_a.length > 0) {
          const repo_collection = await returnRepoCollection(repo_a)
          if (
            selected_a === repo_a &&
            repo_collection.events[repo_collection.most_recent_index]
              .unique_commit
          ) {
            proposal_summaries.update((proposals) => {
              return {
                ...proposals,
                summaries: [
                  ...proposals.summaries.filter(
                    (summary) =>
                      (event.tags.some(
                        (t) => t.length > 1 && t[1] === 'root'
                      ) &&
                        !event.tags.some(
                          (t) => t.length > 1 && t[1] === 'revision-root'
                        )) ||
                      event.id !== summary.id
                  ),
                ],
              }
            })
          }
        }
      }
    } catch {}
  })
  sub.on('eose', () => {
    proposal_summaries.update((proposals) => {
      getAndUpdateProposalStatus(proposals, relays_to_use)
      return {
        ...proposals,
        loading: false,
      }
    })
  })
}

let sub_statuses: NDKSubscription

function getAndUpdateProposalStatus(
  proposals: ProposalSummaries,
  relays: string[]
): void {
  if (sub_statuses) sub_statuses.stop()
  sub_statuses = ndk.subscribe(
    {
      kinds: proposal_status_kinds,
      '#e': proposals.summaries.map((proposal) => proposal.id),
    },
    {
      closeOnEose: false,
    },
    NDKRelaySet.fromRelayUrls(relays, ndk)
  )
  sub_statuses.on('event', (event: NDKEvent) => {
    const tagged_proposal_event = event.tagValue('e')
    if (
      event.kind &&
      proposal_status_kinds.includes(event.kind) &&
      tagged_proposal_event &&
      event.created_at
    ) {
      proposal_summaries.update((proposals) => {
        return {
          ...proposals,
          summaries: proposals.summaries.map((o) => {
            if (
              o.id === tagged_proposal_event &&
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
    proposal_summaries.update((proposals) => {
      return {
        ...proposals,
        summaries: proposals.summaries.map((o) => ({
          ...o,
          status: o.status || proposal_status_open,
        })),
      }
    })
  })
}

export const extractRepoAFromProposalEvent = (
  event: NDKEvent
): string | undefined => {
  const value = event.tagValue('a')
  if (!value) return undefined
  const split = value.split(':')
  if (split.length < 3) return undefined
  return value
}
