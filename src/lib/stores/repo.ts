import { writable, type Unsubscriber, type Writable } from 'svelte/store'
import type { RepoCollection, RepoEvent } from '$lib/components/repo/type'
import { collection_defaults, event_defaults } from '$lib/components/repo/type'
import { ensureRepoCollection } from './repos'
import { selectRepoFromCollection } from '$lib/components/repo/utils'

export const selected_repo_collection: Writable<RepoCollection> = writable({
  ...collection_defaults,
})

export const selected_repo_event: Writable<RepoEvent> = writable({
  ...event_defaults,
})

selected_repo_collection.subscribe((collection) => {
  const selected_from_collection = selectRepoFromCollection(collection)
  if (selected_from_collection)
    selected_repo_event.set({ ...selected_from_collection })
})

let selected_repo_unique_commit_or_identifier: string = ''

let selected_unsubscriber: Unsubscriber

export const ensureSelectedRepoCollection = (
  unique_commit_or_identifier: string
): Writable<RepoCollection> => {
  if (
    selected_repo_unique_commit_or_identifier !== unique_commit_or_identifier
  ) {
    selected_repo_unique_commit_or_identifier = unique_commit_or_identifier
    if (selected_unsubscriber) selected_unsubscriber()
    selected_unsubscriber = ensureRepoCollection(
      unique_commit_or_identifier
    ).subscribe((repo_collection) => {
      selected_repo_collection.set({ ...repo_collection })
    })
  }
  return selected_repo_collection
}

export const awaitSelectedRepoCollection = async (
  unique_commit_or_identifier: string
): Promise<RepoCollection> => {
  return new Promise((r) => {
    const unsubscriber = ensureSelectedRepoCollection(
      unique_commit_or_identifier
    ).subscribe((repo_collection) => {
      if (
        selected_repo_unique_commit_or_identifier ==
          unique_commit_or_identifier &&
        !repo_collection.loading
      ) {
        setTimeout(() => {
          unsubscriber()
        }, 5)
        r({ ...repo_collection })
      }
    })
  })
}
