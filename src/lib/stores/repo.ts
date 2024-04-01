import { writable, type Unsubscriber, type Writable } from 'svelte/store'
import type {
  RepoCollection,
  RepoEvent,
  RepoReadme,
} from '$lib/components/repo/type'
import {
  collection_defaults,
  event_defaults,
  readme_defaults,
} from '$lib/components/repo/type'
import { ensureRepoCollection } from './repos'
import {
  extractGithubDetails,
  selectRepoFromCollection,
} from '$lib/components/repo/utils'
import { get } from 'svelte/store'

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
    let loading = true
    selected_repo_unique_commit_or_identifier = unique_commit_or_identifier
    if (selected_unsubscriber) selected_unsubscriber()
    selected_unsubscriber = ensureRepoCollection(
      unique_commit_or_identifier
    ).subscribe((repo_collection) => {
      selected_repo_collection.set({ ...repo_collection })
      if (loading && !repo_collection.loading) {
        loading = false
        const repo_event = selectRepoFromCollection(repo_collection)
        if (repo_event)
          ensureRepoReadme(repo_event.clone, repo_collection.identifier)
      }
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
          if (unsubscriber) unsubscriber()
        }, 5)
        r({ ...repo_collection })
      }
    })
  })
}

export const selected_repo_readme: Writable<RepoReadme> = writable({
  ...readme_defaults,
})

const ensureRepoReadme = async (
  clone: string[],
  unique_commit_or_identifier: string
): Promise<void> => {
  selected_repo_readme.set({ ...readme_defaults })

  /** update writable unless selected readme has changed */
  const update = (md: string | undefined = undefined): void => {
    const latest_collection = get(selected_repo_collection)
    if (
      [latest_collection.identifier, latest_collection.unique_commit].includes(
        unique_commit_or_identifier
      )
    ) {
      selected_repo_readme.set({
        md: md || '',
        loading: false,
        failed: !md,
      })
    }
  }
  try {
    const github_details = clone
      .map(extractGithubDetails)
      .find((details) => !!details)
    let res: Response
    if (github_details) {
      try {
        res = await fetch(
          `https://raw.githubusercontent.com/${github_details.org}/${github_details.repo_name}/HEAD/README.md`
        )
        if (!res.ok) {
          throw 'api request error'
        }
      } catch {
        res = await fetch(
          `https://raw.githubusercontent.com/${github_details.org}/${github_details.repo_name}/HEAD/readme.md`
        )
      }
    } else
      res = await fetch(`/git_proxy/readme/${encodeURIComponent(clone[0])}`)
    if (!res.ok) {
      throw 'api request error'
    }
    let text = ''
    text = await res.text()
    update(text)
  } catch (e) {
    update()
  }
}
