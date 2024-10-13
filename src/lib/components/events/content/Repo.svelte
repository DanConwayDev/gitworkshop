<script lang="ts">
  import {
    eventToRepoAnn,
    repoToNaddr,
    type RepoAnnCollection,
  } from '$lib/dbs/types'
  import type { Event } from 'nostr-tools'

  export let event: Event | RepoAnnCollection

  let repo = 'identifier' in event ? event : eventToRepoAnn(event)
</script>

{#if repo}
  <span class="">
    Git Repository: <a href={`/r/${repoToNaddr(repo)}`}>{repo.name}</a> by
  </span>
{/if}
