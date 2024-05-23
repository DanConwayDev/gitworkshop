<script lang="ts">
  import RepoDetails from '$lib/wrappers/RepoDetails.svelte'
  import {
    ensureSelectedRepoCollection,
    selected_repo_collection,
    selected_repo_event,
  } from '$lib/stores/repo'
  import RepoHeader from '$lib/components/repo/RepoHeader.svelte'
  import Container from '$lib/components/Container.svelte'
  import ComposeIssue from '$lib/wrappers/ComposeIssue.svelte'
  import { naddrToRepoA } from '$lib/components/repo/utils'
  import AlertError from '$lib/components/AlertError.svelte'

  export let data: { repo_naddr: string }
  let repo_naddr = data.repo_naddr
  let invalid_naddr = false
  let a = ''

  $: {
    const a_result = naddrToRepoA(repo_naddr)
    if (a_result) {
      a = a_result
      invalid_naddr = false
      ensureSelectedRepoCollection(a)
    } else {
      invalid_naddr = true
    }
  }

  let waited_5_secs = false
  setTimeout(() => {
    waited_5_secs = true
  }, 5000)
</script>

{#if invalid_naddr || (waited_5_secs && $selected_repo_collection.loading && $selected_repo_event.name.length)}
  <Container>
    <AlertError>
      {#if invalid_naddr}
        <div>Error! invalid naddr in url:</div>
        <div class="break-all">{repo_naddr}</div>
      {:else}
        <div>Error! cannot find repository event:</div>
        <div class="break-all">{repo_naddr}</div>
      {/if}
    </AlertError>
  </Container>
{:else}
  <RepoHeader {...$selected_repo_event} />

  <Container>
    <div class="mt-2 lg:flex">
      <div class="prose lg:mr-2 lg:w-2/3">
        <h4>Create Issue</h4>
        <ComposeIssue repo_event={$selected_repo_event} />
      </div>
      <div class="prose ml-2 hidden w-1/3 lg:flex">
        <RepoDetails {a} />
      </div>
    </div>
  </Container>
{/if}
