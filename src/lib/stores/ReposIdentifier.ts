import type { RepoDIdentiferCollection } from '$lib/components/repo/type'
import { writable, type Writable } from 'svelte/store'
import { ensureRepo, eventToRepoEvent } from './repos'
import { base_relays, ndk } from './ndk'
import { repo_kind } from '$lib/kinds'
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'

export const repos_identifer: {
  [d: string]: Writable<RepoDIdentiferCollection>
} = {}

export const ensureIdentifierRepoCollection = (
  identifier: string
): Writable<RepoDIdentiferCollection> => {
  if (!Object.keys(repos_identifer).includes(identifier)) {
    repos_identifer[identifier] = writable({
      d: '',
      events: [],
      loading: true,
    })
    const sub = ndk.subscribe(
      { kinds: [repo_kind], '#d': [identifier] },
      { closeOnEose: true },
      NDKRelaySet.fromRelayUrls(base_relays, ndk)
    )
    sub.on('event', (event: NDKEvent) => {
      const repo_event = eventToRepoEvent(event)
      if (repo_event && repo_event.identifier === identifier) {
        ensureRepo(event).subscribe((repo_event) => {
          repos_identifer[identifier].update((collection) => {
            let events = collection.events
            let exists = false
            events.map((e) => {
              if (e.author === repo_event.author) {
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
      repos_identifer[identifier].update((collection) => ({
        ...collection,
        loading: false,
      }))
    })
  }
  return repos_identifer[identifier]
}
