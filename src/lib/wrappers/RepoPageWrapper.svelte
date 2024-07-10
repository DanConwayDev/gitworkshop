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
  import { naddrToPointer, naddrToRepoA } from '$lib/components/repo/utils'
  import AlertError from '$lib/components/AlertError.svelte'

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
      ensureSelectedRepoCollection(a, naddrToPointer(repo_naddr)?.relays)
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

<RepoHeader {...$selected_repo_event} {selected_tab} />
{#if invalid_naddr}
  <Container>
    <AlertError>
      <div>Error! invalid naddr in url:</div>
      <div class="break-all">{repo_naddr}</div>
    </AlertError>
  </Container>
  <Container>
    <slot />
  </Container>
{/if}
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
        <div class="prose my-3 px-6 md:ml-2 md:px-0 w-full">
          <RepoDetails {a} />
        </div>
      </div>
    </div>
  </Container>
{:else}
  <slot />
{/if}
