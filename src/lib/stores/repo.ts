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
import { selectRepoFromCollection } from '$lib/components/repo/utils'
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
  clone: string,
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
    const github_details = extractGithubDetails(clone)
    // feature stapled off
    const feature_staple = false
    if (github_details && feature_staple) {
      const res = await fetch(
        // `/git_proxy/readme?clone=${encodeURIComponent(clone)}`
        `https://raw.githubusercontent.com/${github_details.org}/${github_details.repo_name}/HEAD/README.md`
      )
      if (!res.ok) {
        throw 'api request error'
      }
      let text = ''
      text = await res.text()
      update(text)
    } else {
      // use proxy to get readme using 'git archive' or 'git clone'
    }
  } catch (e) {
    update()
  }
}

const extractGithubDetails = (
  clone: string
): { org: string; repo_name: string } | undefined => {
  if (clone.indexOf('github.') > -1) {
    const g_split = clone.split('github.')
    if (g_split.length > 0) {
      const slash_split = g_split[1].split('/')
      if (slash_split.length > 2) {
        return {
          org: slash_split[1],
          repo_name: slash_split[2].split('.')[0],
        }
      }
    }
  }
  return undefined
}
