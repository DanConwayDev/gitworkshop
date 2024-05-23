<script lang="ts">
  import RepoDetails from '$lib/wrappers/RepoDetails.svelte'
  import {
    ensureSelectedRepoCollection,
    selected_repo_collection,
    selected_repo_event,
  } from '$lib/stores/repo'
  import RepoHeader from '$lib/components/repo/RepoHeader.svelte'
  import Container from '$lib/components/Container.svelte'
  import { ensureProposalSummaries } from '$lib/stores/Proposals'
  import { ensureIssueSummaries } from '$lib/stores/Issues'
  import type { RepoPage } from '$lib/components/repo/type'
  import { naddrToRepoA } from '$lib/components/repo/utils'

  export let repo_naddr = ''
  export let selected_tab: RepoPage = 'about'
  export let with_side_bar = true
  export let show_details_on_mobile = false

  let invalid_naddr = false
  let a = ''

  $: {
    const a_result = naddrToRepoA(repo_naddr)
    if (a_result) {
      a = a_result
      invalid_naddr = false
      ensureSelectedRepoCollection(a)
      ensureProposalSummaries(a)
      ensureIssueSummaries(a)
    } else {
      invalid_naddr = true
    }
  }

  let waited_5_secs = false
  setTimeout(() => {
    waited_5_secs = true
  }, 5000)
</script>

{#if invalid_naddr || (waited_5_secs && !$selected_repo_collection.loading && $selected_repo_event.name.length === 0)}
  <Container>
    <div role="alert" class="max-w-xl m-auto">
      <div role="alert" class="alert alert-error m-auto mt-6 break-all">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          /></svg
        >
        <div>
        {#if invalid_naddr}
          <div>Error! invalid naddr in url:</div>
          <div class="break-all">{repo_naddr}</div>
        {:else}
          <div>Error! cannot find repository event:</div>
          <div class="break-all">{repo_naddr}</div>
        {/if}
        </div>
      </div>
    </div>
  </Container>
{:else}
  <RepoHeader {...$selected_repo_event} {selected_tab} />
  {#if with_side_bar}
    <Container>
      <div class="mt-2 md:flex">
        <div class="md:mr-2 md:w-2/3">
          <slot />
        </div>
        <div
          class:hidden={!show_details_on_mobile}
          class=" rounded-lg border border-base-400 md:flex md:w-1/3 md:border-none"
        >
          <div class="border-b border-base-400 bg-base-300 px-6 py-3 md:hidden">
            <h4 class="">Repository Details</h4>
          </div>
          <div class="prose my-3 px-6 md:ml-2 md:px-0">
            <RepoDetails {a} />
          </div>
        </div>
      </div>
    </Container>
  {:else}
    <slot />
  {/if}
{/if}
