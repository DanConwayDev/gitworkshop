<script lang="ts">
  import RepoDetails from '$lib/wrappers/RepoDetails.svelte'
  import {
    ensureSelectedRepoCollection,
    selected_repo_collection,
  } from '$lib/stores/repo'
  import RepoHeader from '$lib/components/repo/RepoHeader.svelte'
  import Container from '$lib/components/Container.svelte'
  import ComposeIssue from '$lib/wrappers/ComposeIssue.svelte'
  import { naddrToPointer, naddrToRepoA } from '$lib/components/repo/utils'
  import AlertError from '$lib/components/AlertError.svelte'
  import { selectedRepoCollectionToName } from '$lib/dbs/types'

  export let data: { repo_naddr: string }
  let repo_naddr = data.repo_naddr
  $: name = selectedRepoCollectionToName($selected_repo_collection)
  $: a = naddrToRepoA(repo_naddr)
  $: {
    if (a) ensureSelectedRepoCollection(a, naddrToPointer(repo_naddr)?.relays)
  }

  let waited_5_secs = false
  setTimeout(() => {
    waited_5_secs = true
  }, 5000)
</script>

<svelte:head>
  <title>GitWorkshop: {name} - new issue</title>
</svelte:head>

{#if !a || (waited_5_secs && (!$selected_repo_collection || ('loading' in $selected_repo_collection && $selected_repo_collection.loading === false)))}
  <Container>
    <AlertError>
      {#if !a}
        <div>Error! invalid naddr in url:</div>
        <div class="break-all">{repo_naddr}</div>
      {:else}
        <div>Error! cannot find repository event:</div>
        <div class="break-all">{repo_naddr}</div>
      {/if}
    </AlertError>
  </Container>
{:else}
  <RepoHeader repo_collection={$selected_repo_collection} />

  <Container>
    <div class="mt-2 lg:flex">
      <div class="prose lg:mr-2 lg:w-2/3">
        <h4>Create Issue</h4>
        {#if $selected_repo_collection}
          <ComposeIssue repo_collection={$selected_repo_collection} />
        {:else}
          <span class="loading loading-spinner loading-xs ml-2 text-neutral"
          ></span>
        {/if}
      </div>
      <div class="prose ml-2 hidden w-1/3 lg:flex">
        <RepoDetails {a} />
      </div>
    </div>
  </Container>
{/if}
