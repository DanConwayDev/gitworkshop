<script lang="ts">
  import {
    ensureSelectedRepoCollection,
    selected_repo_collection,
    selected_repo_event,
  } from '$lib/stores/repo'
  import {
    ensureProposalFull,
    selected_proposal_full,
    selected_proposal_replies,
  } from '$lib/stores/Proposal'
  import ProposalHeader from '$lib/components/proposals/ProposalHeader.svelte'
  import RepoHeader from '$lib/components/repo/RepoHeader.svelte'
  import Thread from '$lib/wrappers/Thread.svelte'
  import ProposalDetails from '$lib/components/proposals/ProposalDetails.svelte'
  import Container from '$lib/components/Container.svelte'

  export let data: {
    repo_id: string
    proposal_id: string
  }

  let repo_id = data.repo_id
  let proposal_id = data.proposal_id

  ensureSelectedRepoCollection(repo_id)
  ensureProposalFull(repo_id, proposal_id)

  let repo_error = false
  let proposal_error = false
  $: {
    repo_error =
      !$selected_repo_collection.loading &&
      $selected_repo_event.name.length === 0
    proposal_error =
      !$selected_proposal_full.summary.loading &&
      $selected_proposal_full.summary.created_at === 0
  }
</script>

{#if !repo_error}
  <RepoHeader {...$selected_repo_event} />
{/if}

{#if proposal_error}
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
      <span
        >Error! cannot find Proposal {repo_error ? 'or repo ' : ''}event</span
      >
    </div>
  </Container>
{:else}
  <ProposalHeader {...$selected_proposal_full.summary} />
  <Container>
    <div class="mx-auto max-w-6xl lg:flex">
      <div class="lg:w-2/3 xl:mr-2">
        <div class="max-w-4xl">
          {#if $selected_proposal_full.proposal_event}
            <Thread
              type="proposal"
              event={$selected_proposal_full.proposal_event}
              replies={$selected_proposal_replies}
            />
          {/if}
        </div>
      </div>
      <div class="prose ml-2 hidden w-1/3 lg:block">
        <div role="alert" class="max-w-2 alert mt-3">
          <div class="text-center">
            <div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                class="inline h-6 w-6 shrink-0 stroke-info"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                ></path></svg
              >
              <h3 class="prose mx-1 inline text-sm font-bold">
                view in local git repository
              </h3>
            </div>

            <p class="mx-0 mb-1 mt-2 text-xs">
              <a href="/ngit">install ngit</a>, run
              <span class="rounded bg-neutral p-1 font-mono"
                ><span class="py-3">ngit list</span></span
              > from the local repository and select the proposal title
            </p>
          </div>
        </div>
        <div class="block">
          <ProposalDetails
            type="proposal"
            summary={$selected_proposal_full.summary}
            labels={$selected_proposal_full.labels}
            loading={$selected_proposal_full.loading}
          />
        </div>
      </div>
    </div>
  </Container>
{/if}
