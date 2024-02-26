<script lang="ts">
  import ReposSummaryList from '$lib/components/ReposSummaryList.svelte'
  import type { RepoEvent, RepoSummary } from '$lib/components/repo/type'
  import { repo_kind } from '$lib/kinds'
  import { ndk } from '$lib/stores/ndk'
  import {
    ensureRepoCollection,
    eventToRepoEvent,
    repoCollectionToSummary,
  } from '$lib/stores/repos'
  import type { NDKEvent } from '@nostr-dev-kit/ndk'
  import { onDestroy } from 'svelte'
  import { writable, type Writable } from 'svelte/store'

  export let limit: number = 100

  let repos: Writable<RepoSummary[]> = writable([])

  let loading: boolean = true
  let sub = ndk.subscribe({
    kinds: [repo_kind],
    limit,
  })
  let events: RepoEvent[] = []
  sub.on('event', (event: NDKEvent) => {
    let repo_event = eventToRepoEvent(event)
    if (repo_event) events.push(repo_event)
  })
  sub.on('eose', () => {
    let unique_commits = [
      ...new Set(events.map((e) => e.unique_commit).filter((s) => !!s)),
    ] as string[]
    let identifers_not_linked_to_unique_commit = [
      ...new Set(events.map((e) => e.identifier)),
    ].filter(
      (identifier) =>
        !events.some((e) => e.identifier == identifier && e.unique_commit)
    )
    unique_commits
      .concat(identifers_not_linked_to_unique_commit)
      .forEach((c) => {
        ensureRepoCollection(c).subscribe((repo_collection) => {
          let summary = repoCollectionToSummary(repo_collection)
          if (!summary) return
          repos.update((repos) => {
            // if duplicate
            if (
              repos.some(
                (repo) =>
                  (repo.unique_commit &&
                    repo.unique_commit === repo_collection.unique_commit) ||
                  (!repo.unique_commit &&
                    repo.identifier === repo_collection.identifier)
              )
            ) {
              return [
                // update summary
                ...repos.map((repo) => {
                  if (
                    summary &&
                    ((repo.unique_commit &&
                      repo.unique_commit === repo_collection.unique_commit) ||
                      (!repo.unique_commit &&
                        repo.identifier === repo_collection.identifier))
                  )
                    return summary
                  return { ...repo }
                }),
              ]
            }
            // if not duplicate - add summary
            else if (summary) return [...repos, summary]
            return [...repos]
          })
        })
      })
    if (loading == true) loading = false
  })

  onDestroy(() => {
    sub.stop()
  })
</script>

<ReposSummaryList title="Latest Repositories" repos={$repos} {loading} />
