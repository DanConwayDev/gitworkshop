<script lang="ts">
  import RepoDetails from '$lib/components/repo/RepoDetails.svelte'
  import type { ARef } from '$lib/dbs/types'
  import {
    ensureSelectedRepoCollection,
    selected_repo_collection,
  } from '$lib/stores/repo'

  export let a: ARef | undefined = undefined

  $: {
    if (a) ensureSelectedRepoCollection(a)
  }
</script>

{#if $selected_repo_collection}
  <RepoDetails repo={$selected_repo_collection} />
{/if}
