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
  import RepoMenu from '$lib/wrappers/RepoMenu.svelte'

  export let identifier = ''
  export let selected_tab: '' | 'issues' | 'proposals' = ''

  ensureSelectedRepoCollection(identifier)
  ensureProposalSummaries(identifier)
  ensureIssueSummaries(identifier)

  let repo_error = false

  let waited_5_secs = false
  setTimeout(() => {
    waited_5_secs = true
  }, 5000)

  $: {
    repo_error =
      !$selected_repo_collection.loading &&
      waited_5_secs &&
      $selected_repo_event.name.length === 0
  }
</script>

{#if repo_error}
  <Container>
    <div role="alert" class="alert alert-error m-auto mt-6 w-full max-w-xs">
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
      <span>Error! cannot find repository event</span>
    </div>
  </Container>
{:else}
  <RepoHeader {...$selected_repo_event} />

  <Container>
    <div class="mt-2 md:flex">
      <div class="md:mr-2 md:w-2/3">
        <RepoMenu {identifier} {selected_tab} />
        <slot />
      </div>
      <div class="prose ml-2 hidden w-1/3 md:flex">
        <RepoDetails repo_id={identifier} />
      </div>
    </div>
  </Container>
{/if}
