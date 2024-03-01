import {
  NDKRelaySet,
  type NDKEvent,
  NDKSubscription,
  type NDKFilter,
} from '@nostr-dev-kit/ndk'
import { writable, type Unsubscriber, type Writable } from 'svelte/store'
import { base_relays, ndk } from './ndk'
import { summary_defaults } from '$lib/components/proposals/type'
import type { User } from '$lib/components/users/type'
import { ensureUser } from './users'
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
  id: '',
  summaries: [],
  loading: false,
})

let selected_repo_id: string | undefined = ''

let authors_unsubscribers: Unsubscriber[] = []

let sub: NDKSubscription

export const ensureProposalSummaries = async (repo_id: string | undefined) => {
  if (selected_repo_id == repo_id) return
  proposal_summaries.set({
    id: repo_id,
    summaries: [],
    loading: repo_id !== '',
  })

  if (sub) sub.stop()
  if (sub_statuses) sub_statuses.stop()
  authors_unsubscribers.forEach((u) => u())
  authors_unsubscribers = []

  selected_repo_id = repo_id

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

  if (repo_id) {
    const repo_collection = await awaitSelectedRepoCollection(repo_id)

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
          (m) => `${repo_kind}:${m.hexpubkey}:${repo.identifier}`
        ),
        limit: 100,
      }
    } else {
      filter = {
        kinds: [patch_kind],
        '#a': repo.maintainers.map(
          (m) => `${repo_kind}:${m.hexpubkey}:${repo.identifier}`
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
        if (!extractRepoIdentiferFromProposalEvent(event) && !repo_id) {
          // link to proposal will not work as it requires an identifier
          return
        }
        const repo_identifier =
          extractRepoIdentiferFromProposalEvent(event) || repo_id || ''

        proposal_summaries.update((proposals) => {
          return {
            ...proposals,
            summaries: [
              ...proposals.summaries,
              {
                ...summary_defaults,
                id: event.id,
                repo_identifier,
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

        // filter out non root proposals if repo event supports nip34+ features
        if (!repo_id && repo_identifier.length > 0) {
          const repo_collection = await returnRepoCollection(repo_identifier)
          if (selected_repo_id === repo_id && repo_collection.unique_commit) {
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

      authors_unsubscribers.push(
        ensureUser(event.pubkey).subscribe((u: User) => {
          proposal_summaries.update((proposals) => {
            return {
              ...proposals,
              summaries: proposals.summaries.map((o) => ({
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

export const extractRepoIdentiferFromProposalEvent = (
  event: NDKEvent
): string | undefined => {
  const value = event.tagValue('a')
  if (!value) return undefined
  const split = value.split(':')
  if (split.length < 3) return undefined
  return split[2]
}
