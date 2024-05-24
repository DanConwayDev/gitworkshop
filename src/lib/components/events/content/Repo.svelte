<script lang="ts">
  import type { RepoEvent } from '$lib/components/repo/type'
  import { eventToRepoEvent } from '$lib/stores/repos'
  import type { NDKEvent } from '@nostr-dev-kit/ndk'

  export let event: NDKEvent | RepoEvent

  const isRepoEvent = (event: NDKEvent | RepoEvent): event is RepoEvent => {
    return Object.keys(event).includes('web')
  }

  let repo = isRepoEvent(event) ? event : eventToRepoEvent(event)
</script>

{#if repo}
  <span class="">
    Git Repository: <a href={`/r/${repo.naddr}`}>{repo.name}</a> by
  </span>
{/if}
