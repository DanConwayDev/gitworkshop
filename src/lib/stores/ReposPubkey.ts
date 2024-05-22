import type { SelectedPubkeyRepoCollections } from '$lib/components/repo/type'
import { get, writable, type Unsubscriber, type Writable } from 'svelte/store'
import { ensureRepoCollection, eventToRepoEvent } from './repos'
import { base_relays, ndk } from './ndk'
import { repo_kind } from '$lib/kinds'
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { extractAReference } from '$lib/components/repo/utils'

export const selected_npub_repo_collections: Writable<SelectedPubkeyRepoCollections> =
  writable({
    pubkey: '',
    collections: [],
  })

const unsubscribers: Unsubscriber[] = []

export const ensureSelectedPubkeyRepoCollection = (
  pubkey: string
): Writable<SelectedPubkeyRepoCollections> => {
  const collections = get(selected_npub_repo_collections)
  if (collections.pubkey === pubkey) return selected_npub_repo_collections
  // TODO call unsubscribers
  selected_npub_repo_collections.set({
    pubkey,
    collections: [],
  })

  const sub = ndk.subscribe(
    { kinds: [repo_kind], authors: [pubkey] },
    { closeOnEose: true },
    NDKRelaySet.fromRelayUrls(base_relays, ndk)
  )
  const identifiers: string[] = []
  sub.on('event', (event: NDKEvent) => {
    const repo_event = eventToRepoEvent(event)
    if (
      repo_event &&
      repo_event.author === pubkey &&
      !identifiers.includes(repo_event.identifier)
    )
      identifiers.push(repo_event.identifier)
  })
  sub.on('eose', () => {
    identifiers.forEach((identifier) => {
      unsubscribers.push(
        ensureRepoCollection(`${repo_kind}:${pubkey}:${identifier}`).subscribe(
          (c) => {
            if (!c.maintainers.includes(pubkey)) return

            selected_npub_repo_collections.update((selected_collections) => {
              if (selected_collections.pubkey !== pubkey)
                return { ...selected_collections }
              let collection_in_selected_collections = false
              const collections = selected_collections.collections.map(
                (old_c) => {
                  const ref = extractAReference(old_c.selected_a)
                  if (ref && ref.identifier === identifier) {
                    collection_in_selected_collections = true
                    return {
                      ...c,
                    }
                  }
                  return { ...old_c }
                }
              )
              if (!collection_in_selected_collections) collections.push(c)
              return {
                ...selected_collections,
                collections,
              }
            })
          }
        )
      )
    })
  })
  return selected_npub_repo_collections
}
