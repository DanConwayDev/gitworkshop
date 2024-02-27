<script lang="ts">
  import RepoDetails from '$lib/wrappers/RepoDetails.svelte'
  import {
    ensureSelectedRepoCollection,
    selected_repo_collection,
    selected_repo_event,
  } from '$lib/stores/repo'
  import RepoHeader from '$lib/components/repo/RepoHeader.svelte'
  import Container from '$lib/components/Container.svelte'
  import {
    ensureProposalSummaries,
    proposal_summaries,
  } from '$lib/stores/Proposals'
  import ProposalsList from '$lib/components/proposals/ProposalsList.svelte'
  import { ensureIssueSummaries, issue_summaries } from '$lib/stores/Issues'

  export let data: { repo_id: string }
  let identifier = data.repo_id

  ensureSelectedRepoCollection(identifier)
  ensureProposalSummaries(identifier)
  ensureIssueSummaries(identifier)

  let selected_tab: 'issues' | 'proposals' = 'proposals'

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
        <div class="flex border-b border-base-400">
          <div role="tablist" class="tabs tabs-bordered flex-none">
            <button
              on:click={() => {
                selected_tab = 'proposals'
              }}
              role="tab"
              class="tab"
              class:tab-active={selected_tab === 'proposals'}
            >
              Proposals
              {#if !$proposal_summaries.loading}
                <span class="pl-1 opacity-30">
                  ({$proposal_summaries.summaries.length})
                </span>
              {/if}
            </button>
            <button
              on:click={() => {
                selected_tab = 'issues'
              }}
              role="tab"
              class="tab"
              class:tab-active={selected_tab === 'issues'}
            >
              Issues
              {#if !$issue_summaries.loading}
                <span class="pl-1 opacity-30">
                  ({$issue_summaries.summaries.length})
                </span>
              {/if}
            </button>
          </div>
          <div class="flex-grow"></div>
        </div>
        {#if selected_tab === 'proposals'}
          <ProposalsList
            proposals_or_issues={$proposal_summaries.summaries}
            loading={$proposal_summaries.loading}
          />
          <div role="alert" class="alert mt-6">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              class="h-6 w-6 shrink-0 stroke-info"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path></svg
            >
            <div>
              <h3 class="prose mb-2 text-sm font-bold">
                want to submit a proposal?
              </h3>
              <p class="prose text-xs">
                <a href="/ngit">install ngit</a>, create add a feature in the
                local repository and run
                <span class="rounded bg-neutral p-1 font-mono"
                  ><span class="py-3">ngit send</span></span
                >
              </p>
            </div>
          </div>
        {:else if selected_tab === 'issues'}
          <ProposalsList
            proposals_or_issues={$issue_summaries.summaries}
            loading={$issue_summaries.loading}
          />
          <a class="btn btn-success my-3" href="/repo/{identifier}/issues/new">
            create issue
          </a>
        {/if}
      </div>
      <div class="prose ml-2 hidden w-1/3 md:flex">
        <RepoDetails repo_id={identifier} />
      </div>
    </div>
  </Container>
{/if}
