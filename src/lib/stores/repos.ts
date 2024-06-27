import {
  event_defaults,
  collection_defaults,
  type RepoCollection,
  type RepoEvent,
  type RepoSummary,
} from '$lib/components/repo/type'
import { NDKRelaySet, NDKEvent } from '@nostr-dev-kit/ndk'
import { get, writable, type Writable } from 'svelte/store'
import { base_relays, ndk } from './ndk'
import { repo_kind } from '$lib/kinds'
import {
  extractAReference,
  selectRepoFromCollection,
} from '$lib/components/repo/utils'
import { nip19 } from 'nostr-tools'

export const repos: {
  [a: string]: Writable<RepoEvent>
} = {}

export const repo_collections: {
  [a: string]: Writable<RepoCollection>
} = {}

export const ensureRepo = (a: string | NDKEvent): Writable<RepoEvent> => {
  if (typeof a !== 'string') {
    const repo_event = eventToRepoEvent(a)
    if (repo_event) {
      const a = repoEventToARef(repo_event)
      repos[a] = writable({ ...repo_event, loading: true })
      fetchReferencedBy(repo_event)
      return repos[a]
    }
    return repos['']
  }
  if (!repos[a]) {
    const base: RepoEvent = {
      ...event_defaults,
    }

    const a_ref = extractAReference(a)

    if (!a_ref) return writable(base)

    const { pubkey, identifier } = a_ref

    repos[a] = writable({
      ...base,
      identifier,
      author: pubkey,
    })

    const sub = ndk.subscribe(
      { kinds: [repo_kind], '#d': [identifier], authors: [pubkey] },
      {
        groupable: true,
        // default 100
        groupableDelay: 200,
        closeOnEose: false,
      },
      NDKRelaySet.fromRelayUrls(base_relays, ndk)
    )
    sub.on('event', (event: NDKEvent) => {
      const repo_event = eventToRepoEvent(event)

      if (repo_event) {
        if (
          identifier === repo_event.identifier &&
          pubkey === repo_event.author
        )
          repos[a].update(() => {
            return {
              ...repo_event,
            }
          })
        fetchReferencedBy(repo_event)
        // TODO fetch stargazers
      }
    })
    sub.on('eose', () => {
      // still awaiting reference_by at this point
      repos[a].update((repo_event) => {
        return {
          ...repo_event,
          loading: false,
        }
      })
    })
  }
  setTimeout(() => {
    repos[a].update((repo_event) => {
      return {
        ...repo_event,
        loading: false,
      }
    })
  }, 5000)
  return repos[a]
}

export const returnRepo = async (a: string): Promise<RepoEvent> => {
  return new Promise((r) => {
    const unsubscriber = ensureRepo(a).subscribe((c) => {
      if (!c.loading) {
        setTimeout(() => {
          if (unsubscriber) unsubscriber()
        }, 5)
        r(c)
      }
    })
  })
}

export const ensureRepoCollection = (a: string): Writable<RepoCollection> => {
  if (!repo_collections[a]) {
    const base: RepoCollection = {
      ...collection_defaults,
      selected_a: a,
    }

    repo_collections[a] = writable(base)

    const a_ref = extractAReference(a)

    if (!a_ref) return repo_collections[a]

    const { pubkey, identifier } = a_ref

    returnRepo(a).then(async (repo_event) => {
      if (get(repo_collections[a]).events.length > 0) return
      repo_collections[a].update((collection) => {
        return {
          ...collection,
          events: [repo_event],
          maintainers: repo_event.maintainers,
          most_recent_index: 0,
        }
      })

      const new_maintainers: string[] = []

      const addMaintainers = async (m: string) => {
        const m_repo_event = await returnRepo(`${repo_kind}:${m}:${identifier}`)
        repo_collections[a].update((collection) => {
          m_repo_event.maintainers.forEach((m) => {
            if (
              ![pubkey, ...collection.maintainers, ...new_maintainers].includes(
                m
              )
            )
              new_maintainers.push(m)
          })
          const events = [...collection.events, m_repo_event]
          const most_recent = events.sort(
            (a, b) => b.created_at - a.created_at
          )[0]
          return {
            ...collection,
            events,
            most_recent_index: events.findIndex(
              (e) => e.author === most_recent.author
            ),
            maintainers: [...collection.maintainers, ...new_maintainers],
          }
        })
      }

      // add maintainer events
      await Promise.all(
        repo_event.maintainers
          .filter((m) => m !== pubkey)
          .map((m) => addMaintainers(m))
      )

      // also add maintainers included in their maintainer events
      while (new_maintainers.length > 0) {
        await Promise.all(new_maintainers.map((m) => addMaintainers(m)))
      }

      repo_collections[a].update((repo_collection) => {
        return {
          ...repo_collection,
          loading: false,
        }
      })
    })
  }
  setTimeout(() => {
    repo_collections[a].update((repo_collection) => {
      return {
        ...repo_collection,
        loading: false,
      }
    })
  }, 5000)
  return repo_collections[a]
}

export const returnRepoCollection = async (
  a: string
): Promise<RepoCollection> => {
  return new Promise((r) => {
    const unsubscriber = ensureRepoCollection(a).subscribe((c) => {
      if (!c.loading) {
        setTimeout(() => {
          if (unsubscriber) unsubscriber()
        }, 5)
        r(c)
      }
    })
  })
}

const repoEventToARef = (repo_event: RepoEvent): string =>
  `${repo_kind}:${repo_event.author}:${repo_event.identifier}`

const fetchReferencedBy = (repo_event: RepoEvent) => {
  const relays_to_use =
    repo_event.relays.length < 3
      ? repo_event.relays
      : [...base_relays].concat(repo_event.relays)

  const ref_sub = ndk.subscribe(
    {
      '#a': [repoEventToARef(repo_event)],
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
    repos[repoEventToARef(repo_event)].update((repo_event) => {
      return {
        ...repo_event,
        referenced_by: repo_event.referenced_by.includes(ref_event.id)
          ? [...repo_event.referenced_by]
          : [...repo_event.referenced_by, ref_event.id],
        most_recent_reference_timestamp:
          ref_event.created_at &&
          repo_event.most_recent_reference_timestamp < ref_event.created_at
            ? ref_event.created_at
            : repo_event.most_recent_reference_timestamp,
      }
    })
  })

  ref_sub.on('eose', () => {
    repos[repoEventToARef(repo_event)].update((repo_event) => {
      return {
        ...repo_event,
        // finished loading repo_event as we have all referenced_by events
        loading: false,
      }
    })
  })
}

export const eventToRepoEvent = (event: NDKEvent): RepoEvent | undefined => {
  if (event.kind !== repo_kind) return undefined

  const maintainers = [event.pubkey]
  event.getMatchingTags('maintainers').forEach((t: string[]) => {
    t.forEach((v, i) => {
      if (i > 0 && v !== maintainers[0]) {
        try {
          nip19.npubEncode(v) // will throw if invalid hex pubkey
          maintainers.push(v)
        } catch {}
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
  const clone: string[] = []
  event.getMatchingTags('clone').forEach((t: string[]) => {
    t.forEach((v, i) => {
      if (i > 0) {
        clone.push(v)
      }
    })
  })
  return {
    event_id: event.id,
    naddr: event.encode(),
    author: event.pubkey,
    identifier: event.replaceableDTag(),
    unique_commit: event.tagValue('r') || undefined,
    name: event.tagValue('name') || '',
    description: event.tagValue('description') || '',
    clone,
    web,
    tags: event.getMatchingTags('t').map((t) => t[1]) || [],
    maintainers,
    relays,
    referenced_by: [],
    most_recent_reference_timestamp: event.created_at || 0,
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
    naddr: selected.naddr,
    unique_commit: selected.unique_commit,
    description: selected.description,
    maintainers: selected.maintainers,
    loading: collection.loading,
    created_at: selected.created_at,
    most_recent_reference_timestamp: Math.max.apply(
      0,
      collection.events.map((e) => e.most_recent_reference_timestamp)
    ),
  } as RepoSummary
}

export const repoEventToSummary = (event: RepoEvent): RepoSummary => {
  return {
    name: event.name,
    identifier: event.identifier,
    naddr: event.naddr,
    unique_commit: event.unique_commit,
    description: event.description,
    maintainers: event.maintainers,
    loading: event.loading,
    created_at: event.created_at,
    most_recent_reference_timestamp: event.most_recent_reference_timestamp,
  } as RepoSummary
}
