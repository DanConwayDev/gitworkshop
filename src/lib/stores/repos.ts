import {
  collection_defaults,
  type RepoCollection,
  type RepoEvent,
  type RepoSummary,
} from '$lib/components/repo/type'
import { NDKRelaySet, type NDKFilter, NDKEvent } from '@nostr-dev-kit/ndk'
import { writable, type Writable } from 'svelte/store'
import { base_relays, ndk } from './ndk'
import { repo_kind } from '$lib/kinds'
import type { User } from '$lib/components/users/type'
import { ensureUser } from './users'
import { selectRepoFromCollection } from '$lib/components/repo/utils'

export const repos: {
  [unique_commit_or_identifier: string]: Writable<RepoCollection>
} = {}

export const ensureRepoCollection = (
  unique_commit_or_identifier: string
): Writable<RepoCollection> => {
  if (!repos[unique_commit_or_identifier]) {
    let base: RepoCollection = {
      ...collection_defaults,
    }
    if (unique_commit_or_identifier.length === 40) {
      base = { ...base, unique_commit: unique_commit_or_identifier }
    } else {
      base = { ...base, identifier: unique_commit_or_identifier }
    }

    repos[unique_commit_or_identifier] = writable(base)
    const filter: NDKFilter = base.unique_commit
      ? {
          kinds: [repo_kind],
          '#r': [base.unique_commit],
          limit: 100,
        }
      : {
          kinds: [repo_kind],
          '#d': [base.identifier],
          limit: 100,
        }
    const sub = ndk.subscribe(
      filter,
      {
        groupable: true,
        // default 100
        groupableDelay: 200,
        closeOnEose: true,
      },
      NDKRelaySet.fromRelayUrls(base_relays, ndk)
    )
    sub.on('event', (event: NDKEvent) => {
      const repo_event = eventToRepoEvent(event)
      if (repo_event) {
        const collection_for_unique_commit =
          unique_commit_or_identifier.length === 40
        // get repo events with same identifer but no unique_commit as
        // the assumption is that they will be the same repo
        if (collection_for_unique_commit) {
          ensureRepoCollection(repo_event.identifier)
          // we will process them just before we turn loading to true
        }
        repos[unique_commit_or_identifier].update((repo_collection) => {
          return {
            ...repo_collection,
            events: [...repo_collection.events, repo_event as RepoEvent],
          }
        })
        const relays_to_use =
          repo_event.relays.length < 3
            ? repo_event.relays
            : [...base_relays].concat(repo_event.relays)

        // get references
        const ref_sub = ndk.subscribe(
          {
            '#a': [
              `${repo_kind}:${repo_event.maintainers[0].hexpubkey}:${repo_event.identifier}`,
            ],
            limit: 10,
          },
          {
            groupable: true,
            // default 100
            groupableDelay: 200,
            closeOnEose: true,
          },
          NDKRelaySet.fromRelayUrls(relays_to_use, ndk)
        )
        ref_sub.on('event', (ref_event: NDKEvent) => {
          repos[unique_commit_or_identifier].update((repo_collection) => {
            return {
              ...repo_collection,
              events: [
                ...repo_collection.events.map((latest_ref_event) => {
                  if (latest_ref_event.event_id === repo_event.event_id) {
                    return {
                      ...latest_ref_event,
                      referenced_by: latest_ref_event.referenced_by
                        ? [...latest_ref_event.referenced_by, ref_event.id]
                        : [ref_event.id],
                    }
                  }
                  return latest_ref_event
                }),
              ],
            }
          })
        })
        ref_sub.on('eose', () => {
          repos[unique_commit_or_identifier].update((repo_collection) => {
            const events = [
              ...repo_collection.events.map((latest_ref_event) => {
                if (latest_ref_event.event_id === repo_event.event_id) {
                  return {
                    ...latest_ref_event,
                    // finished loading repo_event as we have all referenced_by events
                    loading: false,
                  }
                }
                return latest_ref_event
              }),
            ]
            const still_loading_events_in_collection = events.some(
              (e) => e.loading
            )
            if (
              collection_for_unique_commit &&
              !still_loading_events_in_collection
            )
              addEventsWithMatchingIdentifiers(events)

            return {
              ...repo_collection,
              events,
              loading:
                still_loading_events_in_collection ||
                // for uninque_commit loading will complete after extra identifer events are added
                collection_for_unique_commit,
            }
          })
        })

        // load maintainers - we will subscribe later to prevent too many updates
        repo_event.maintainers.forEach((m) => ensureUser(m.hexpubkey))
      }
    })
    sub.on('eose', () => {
      // still awaiting reference_by at this point
      repos[unique_commit_or_identifier].update((repo_collection) => {
        // subscribe to maintainers
        const hexpubkeys = repo_collection.events.flatMap((repo_event) =>
          repo_event.maintainers.map((m) => m.hexpubkey)
        )
        hexpubkeys.forEach((hexpubkey) => {
          ensureUser(hexpubkey).subscribe((u) => {
            repos[unique_commit_or_identifier].update((repo_collection) => ({
              ...repo_collection,
              events: [
                ...repo_collection.events.map((repo_event) => ({
                  ...repo_event,
                  maintainers: [
                    ...repo_event.maintainers.map((m) => ({
                      ...(m.hexpubkey === u.hexpubkey ? u : m),
                    })),
                  ],
                })),
              ],
            }))
          })
        })
        return {
          ...repo_collection,
          loading: false,
        }
      })
    })
  }
  setTimeout(() => {
    repos[unique_commit_or_identifier].update((collection) => {
      return {
        ...collection,
        events: collection.events.map((e) => ({ ...e, loading: false })),
        loading: false,
      }
    })
  }, 5000)
  return repos[unique_commit_or_identifier]
}

export const eventToRepoEvent = (event: NDKEvent): RepoEvent | undefined => {
  if (event.kind !== repo_kind) return undefined

  const maintainers = [
    {
      hexpubkey: event.pubkey,
      loading: true,
      npub: '',
    } as User,
  ]
  event.getMatchingTags('maintainers').forEach((t: string[]) => {
    t.forEach((v, i) => {
      if (i > 0 && v !== maintainers[0].hexpubkey) {
        maintainers.push({
          hexpubkey: v,
          loading: true,
          npub: '',
        } as User)
      }
    })
  })
  const relays: string[] = []
  event.getMatchingTags('relays').forEach((t: string[]) => {
    t.forEach((v, i) => {
      if (i > 0) {
        relays.push(v)
      }
    })
  })
  const web: string[] = []
  event.getMatchingTags('web').forEach((t: string[]) => {
    t.forEach((v, i) => {
      if (i > 0) {
        web.push(v)
      }
    })
  })
  return {
    event_id: event.id,
    identifier: event.replaceableDTag(),
    unique_commit: event.tagValue('r') || undefined,
    name: event.tagValue('name') || '',
    description: event.tagValue('description') || '',
    clone: event.tagValue('clone') || '',
    web,
    tags: event.getMatchingTags('t').map((t) => t[1]) || [],
    maintainers,
    relays,
    referenced_by: [],
    created_at: event.created_at || 0,
    loading: true, // loading until references fetched
  }
}

export const repoCollectionToSummary = (
  collection: RepoCollection
): RepoSummary | undefined => {
  const selected = selectRepoFromCollection(collection)
  if (!selected) return undefined
  return {
    name: selected.name,
    identifier: selected.identifier,
    unique_commit: selected.unique_commit,
    description: selected.description,
    maintainers: selected.maintainers,
    loading: collection.loading,
    created_at: selected.created_at,
  } as RepoSummary
}

/** to be called once all existing events have been found. this
 * function is useful if we assume events with the same
 * identifier reference the same repository */
const addEventsWithMatchingIdentifiers = (exisiting_events: RepoEvent[]) => {
  // add events with same identifier but no unique_commit
  exisiting_events
    // filter out duplicate identifiers
    .filter(
      (e, i) =>
        exisiting_events.findIndex((v) => v.identifier == e.identifier) === i
    )
    // subscribe to each identifier
    .forEach((repo_event) => {
      ensureRepoCollection(repo_event.identifier).subscribe(
        (identiifer_collection) => {
          // if extra event(s)
          if (
            identiifer_collection.events.some(
              (identifier_repo) =>
                !exisiting_events.some(
                  (e) => e.event_id === identifier_repo.event_id
                )
            )
          ) {
            // add identifier events
            repos[repo_event.unique_commit as string].update(
              (repo_collection) => {
                const events = [
                  ...repo_collection.events,
                  ...identiifer_collection.events
                    .filter(
                      (identifier_repo) =>
                        !repo_collection.events.some(
                          (e) => e.event_id === identifier_repo.event_id
                        )
                    )
                    .map((e) => ({ ...e })),
                ]
                return {
                  ...repo_collection,
                  events,
                  // if all RepoEvents are loaded, the collection is too
                  loading: events.some((e) => e.loading),
                }
              }
            )
          }
        }
      )
    })
}
