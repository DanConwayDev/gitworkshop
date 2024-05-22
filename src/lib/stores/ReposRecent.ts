import type { RepoRecentCollection } from '$lib/components/repo/type'
import { writable, type Writable } from 'svelte/store'
import { ensureRepo, eventToRepoEvent } from './repos'
import { base_relays, ndk } from './ndk'
import { repo_kind } from '$lib/kinds'
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'

export const recent_repos: Writable<RepoRecentCollection> = writable({
  events: [],
  loading: true,
})

let started = false

export const ensureRecentRepos = (): Writable<RepoRecentCollection> => {
  if (started) return recent_repos
  started = true
  const sub = ndk.subscribe(
    { kinds: [repo_kind] },
    { closeOnEose: true },
    NDKRelaySet.fromRelayUrls(base_relays, ndk)
  )
  sub.on('event', (event: NDKEvent) => {
    const repo_event = eventToRepoEvent(event)
    if (repo_event) {
      ensureRepo(event).subscribe((repo_event) => {
        recent_repos.update((collection) => {
          let events = collection.events
          let exists = false
          events.map((e) => {
            if (
              e.author === repo_event.author &&
              e.identifier === repo_event.identifier
            ) {
              exists = true
              return repo_event
            } else return e
          })
          if (!exists) events = [...events, repo_event]
          return {
            ...collection,
            events,
          }
        })
      })
    }
  })
  sub.on('eose', () => {
    recent_repos.update((collection) => ({
      ...collection,
      loading: false,
    }))
  })
  return recent_repos
}
