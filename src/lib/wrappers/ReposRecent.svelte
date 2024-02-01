<script lang="ts">
  import type { Args } from '$lib/components/RepoSummaryCard.svelte'
  import ReposSummaryList from '$lib/components/ReposSummaryList.svelte'
  import { repo_kind } from '$lib/kinds'
  import { ndk } from '$lib/stores/ndk'
  import type { NDKEvent } from '@nostr-dev-kit/ndk'
  import { onDestroy } from 'svelte'

  export let limit: number = 10

  let repos: Args[] = []
  let loading: boolean = true
  let sub = ndk.subscribe({
    kinds: [repo_kind],
    limit,
  })
  sub.on('event', (event: NDKEvent) => {
    if (repos.length < limit) {
      try {
        if (
          event.kind == repo_kind &&
          !repos.some(
            (r) =>
              r.repo_id == event.replaceableDTag() &&
              event.created_at &&
              r.created_at > event.created_at
          )
        )
          repos = [
            ...repos.filter(
              (r) =>
                !event.created_at ||
                r.repo_id !== event.replaceableDTag() ||
                r.created_at > event.created_at
            ),
            {
              name: event.tagValue('name') || '',
              description: event.tagValue('description') || '',
              repo_id: event.replaceableDTag(),
              created_at: event.created_at || 0,
            },
          ]
      } catch {}
    } else if (loading == true) loading = false
  })
  sub.on('eose', () => {
    if (loading == true) loading = false
  })

  onDestroy(() => {
    sub.stop()
  })
</script>

<ReposSummaryList title="Latest Repositories" {repos} {loading} />
