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
  cloneArrayToReadMeUrls,
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

let selected_repo_a: string = ''

let selected_unsubscriber: Unsubscriber

export const ensureSelectedRepoCollection = (
  a: string,
  naddr_relays: string[] | undefined = undefined
): Writable<RepoCollection> => {
  if (selected_repo_a !== a) {
    let loading = true
    selected_repo_a = a
    if (selected_unsubscriber) selected_unsubscriber()
    selected_unsubscriber = ensureRepoCollection(a, naddr_relays).subscribe(
      (repo_collection) => {
        selected_repo_collection.set({ ...repo_collection })
        if (loading && !repo_collection.loading) {
          loading = false
          const repo_event = selectRepoFromCollection(repo_collection)
          if (repo_event)
            ensureRepoReadme(repo_event.clone, repo_collection.selected_a)
        }
      }
    )
  }
  return selected_repo_collection
}

export const awaitSelectedRepoCollection = async (
  a: string
): Promise<RepoCollection> => {
  return new Promise((r) => {
    const unsubscriber = ensureSelectedRepoCollection(a).subscribe(
      (repo_collection) => {
        if (selected_repo_a === a && !repo_collection.loading) {
          setTimeout(() => {
            if (unsubscriber) unsubscriber()
          }, 5)
          r({ ...repo_collection })
        }
      }
    )
  })
}

export const selected_repo_readme: Writable<RepoReadme> = writable({
  ...readme_defaults,
})

const ensureRepoReadme = async (clone: string[], a: string): Promise<void> => {
  selected_repo_readme.set({ ...readme_defaults })

  /** update writable unless selected readme has changed */
  const update = (md: string | undefined = undefined): void => {
    const latest_collection = get(selected_repo_collection)
    if (
      [latest_collection.selected_a, latest_collection.selected_a].includes(a)
    ) {
      selected_repo_readme.set({
        md: md || '',
        loading: false,
        failed: !md,
      })
    }
  }
  let text: string | undefined
  try {
    let readme_urls = cloneArrayToReadMeUrls(clone)
    // prioritise using github as it doesn't require a proxy
    readme_urls = [
      ...readme_urls.filter((url) => url.includes('raw.githubusercontent.com')),
      ...readme_urls.filter(
        (url) => !url.includes('raw.githubusercontent.com')
      ),
    ]
    for (let i = 0; i < readme_urls.length; i++) {
      try {
        // temporarily disable using proxy
        if (!readme_urls[i].includes('raw.githubusercontent.com')) {
          continue
        }
        const res = await fetch(
          readme_urls[i]
          // readme_urls[i].includes('raw.githubusercontent.com')
          //   ? readme_urls[i]
          //   : // use proxy as most servers produce a CORS error
          //     `/git_proxy/readme/${encodeURIComponent(readme_urls[i])}`
        )
        if (res.ok) {
          text = await res.text()
          break
        } else {
          continue
        }
      } catch {
        continue
      }
    }
  } catch {}
  update(text)
}
