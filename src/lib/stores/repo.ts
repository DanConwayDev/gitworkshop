import { writable, type Unsubscriber, type Writable } from 'svelte/store'
import type { RepoReadme } from '$lib/components/repo/type'
import { readme_defaults } from '$lib/components/repo/type'
import {
  cloneArrayToReadMeUrls,
  aRefToAddressPointer,
} from '$lib/components/repo/utils'
import { get } from 'svelte/store'
import { naddrEncode, type AddressPointer } from 'nostr-tools/nip19'
import {
  isARef,
  repoToARef,
  repoToARefs,
  selectedRepoIsAddressPointerWithLoading,
  type AndLoading,
  type ARef,
  type IssueOrPrWithReferences,
  type PubKeyString,
  type RepoAnn,
  type RepoAnnCollection,
  type SeenOn,
  type SelectedRepoCollection,
  type WithNaddr,
} from '$lib/dbs/types'
import db from '$lib/dbs/LocalDb'
import { liveQuery } from 'dexie'
import relays_manager from './RelaysManager'

export const selected_repo_collection: Writable<
  SelectedRepoCollection | undefined
> = writable(undefined)

export const selected_issues: Writable<(IssueOrPrWithReferences & SeenOn)[]> =
  writable([])

export const selected_prs: Writable<(IssueOrPrWithReferences & SeenOn)[]> =
  writable([])

let selected_repo_a: ARef | undefined = undefined

let selected_repo_unsubscriber: Unsubscriber
let selected_issues_unsubscriber: Unsubscriber
let selected_prs_unsubscriber: Unsubscriber

export const ensureSelectedRepoCollection = (
  a: ARef | undefined,
  naddr_relays: string[] | undefined = undefined
): Writable<SelectedRepoCollection> => {
  if (selected_repo_a !== a) {
    if (!a || !isARef(a)) {
      selected_repo_a = undefined
      selected_repo_collection.set(undefined)
    } else {
      const address_pointer = aRefToAddressPointer(a)
      if (selected_repo_unsubscriber) selected_repo_unsubscriber()
      if (selected_issues_unsubscriber) selected_issues_unsubscriber()
      if (selected_prs_unsubscriber) selected_prs_unsubscriber()
      if (!address_pointer) {
        selected_repo_a = undefined
        selected_repo_collection.set(undefined)
        throw 'invalid address pointer'
      }
      selected_repo_a = a
      const naddr = naddrEncode(address_pointer)
      selected_repo_collection.set({
        ...address_pointer,
        loading: true,
        naddr: naddr,
      })
      let repo_clone: string[] = []
      setTimeout(() => {
        selected_repo_collection.update((repo) => {
          if (
            selectedRepoIsAddressPointerWithLoading(repo) &&
            repoToARef(repo) === selected_repo_a &&
            repo.loading === true
          ) {
            return { ...repo, loading: false } as AddressPointer &
              AndLoading &
              WithNaddr
          }
          return { ...repo } as RepoAnnCollection & WithNaddr
        })
      }, 5000)
      // Hook up to database
      selected_repo_unsubscriber = liveQuery(() =>
        db.repos
          .where('identifier')
          .equals(address_pointer.identifier)
          .toArray()
      ).subscribe((repo_anns) => {
        try {
          const collection = identifierRepoAnnsToRepoCollection(
            repo_anns,
            address_pointer.pubkey,
            address_pointer.identifier
          )
          if (selected_repo_a !== repoToARef(collection)) return
          selected_repo_collection.set({ ...collection, naddr })
          if (!(collection.clone === repo_clone)) {
            repo_clone = collection.clone
            ensureRepoReadme(repo_clone, a)
          }
        } catch {}
      }).unsubscribe
      selected_issues_unsubscriber = getRepoIssuesObservable(a).subscribe(
        (issues) => {
          selected_issues.set(issues)
        }
      ).unsubscribe
      selected_prs_unsubscriber = getRepoPrsObservable(a).subscribe((prs) => {
        selected_prs.set(prs)
      }).unsubscribe
      // refresh data from relays
      relays_manager.fetchRepoAnnNow(a, naddr_relays).then(() => {
        relays_manager.fetchIssuesAndPRsForRepo(a, naddr_relays)
      })
    }
  }
  return selected_repo_collection
}

export const awaitSelectedRepoCollection = async (
  a: ARef
): Promise<Exclude<SelectedRepoCollection, undefined>> => {
  return new Promise((r) => {
    const unsubscriber = ensureSelectedRepoCollection(a).subscribe(
      (repo_collection) => {
        if (
          selected_repo_a === a &&
          repo_collection &&
          selectedRepoIsAddressPointerWithLoading(repo_collection) &&
          !repo_collection.loading
        ) {
          setTimeout(() => {
            if (unsubscriber) unsubscriber()
          }, 5)
          r({ ...repo_collection })
        }
      }
    )
  })
}

export const getRepoCollectionObservable = (a: ARef) => {
  return liveQuery(async () => {
    const pointer = aRefToAddressPointer(a)
    if (!pointer) return undefined
    const repo_anns = await db.repos
      .where('identifier')
      .equals(pointer.identifier)
      .toArray()
    try {
      return identifierRepoAnnsToRepoCollection(
        repo_anns,
        pointer.pubkey,
        pointer.identifier
      )
    } catch {
      return undefined
    }
  })
}

export const getRepoIssuesObservable = (a: ARef) => {
  return getRepoIssuesOrPrsObservable(a, 'issues')
}

export const getRepoPrsObservable = (a: ARef) => {
  return getRepoIssuesOrPrsObservable(a, 'prs')
}

export const getRepoIssuesOrPrsObservable = (
  a: ARef,
  issues_or_prs: 'issues' | 'prs'
) => {
  return liveQuery(async () => {
    const pointer = aRefToAddressPointer(a)
    if (!pointer) return []
    const repo_anns = await db.repos
      .where('identifier')
      .equals(pointer.identifier)
      .toArray()
    let a_refs = [a]
    try {
      const repo_collection = identifierRepoAnnsToRepoCollection(
        repo_anns,
        pointer.pubkey,
        pointer.identifier
      )
      a_refs = repoToARefs(repo_collection)
    } catch {}
    return db[issues_or_prs]
      .filter((items) =>
        items.parent_ids.some((id) => (a_refs as string[]).includes(id))
      )
      .toArray()
  })
}

export const identifierRepoAnnsToRepoCollection = (
  repo_anns: (RepoAnn & SeenOn)[],
  pubkey: PubKeyString,
  identifier: string
): RepoAnnCollection => {
  const lead_ann = repo_anns.find(
    (ann) => ann.author === pubkey && ann.identifier === identifier
  )
  if (!lead_ann) throw 'could not find lead maintainer repo annoucncement'

  const maintainers = new Set<PubKeyString>()
  const recursivelyAddMaintainers = (m: PubKeyString) => {
    if (!maintainers.has(m)) {
      maintainers.add(m)
      const ann = repo_anns.find((v) => v.author === m)
      if (ann) {
        for (const m of ann.maintainers) {
          recursivelyAddMaintainers(m)
        }
      }
    }
  }
  recursivelyAddMaintainers(lead_ann.author)
  return {
    ...repo_anns
      .filter(
        (ann) => maintainers.has(ann.author) && ann.identifier === identifier
      )
      .reduce((prev, current) =>
        prev.created_at > current.created_at ? prev : current
      ),
    trusted_maintainer: pubkey,
    trusted_maintainer_event_id: lead_ann.event_id || lead_ann.uuid,
    trusted_maintainer_event_created_at: lead_ann.created_at,
  }
}

export const selected_repo_readme: Writable<RepoReadme> = writable({
  ...readme_defaults,
})

const ensureRepoReadme = async (clone: string[], a: ARef): Promise<void> => {
  selected_repo_readme.set({ ...readme_defaults })

  /** update writable unless selected readme has changed */
  const update = (md: string | undefined = undefined): void => {
    const latest_collection = get(selected_repo_collection)
    if (latest_collection && repoToARef(latest_collection) === a) {
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
