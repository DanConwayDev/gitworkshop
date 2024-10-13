<script lang="ts">
  import ProposalsList from '$lib/components/proposals/ProposalsList.svelte'
  import { isRepoLoading, selectedRepoCollectionToName } from '$lib/dbs/types'
  import {
    proposal_status_applied,
    proposal_status_closed,
    proposal_status_draft,
    proposal_status_open,
    statusKindtoText,
  } from '$lib/kinds'
  import { selected_prs, selected_repo_collection } from '$lib/stores/repo'
  import RepoPageWrapper from '$lib/wrappers/RepoPageWrapper.svelte'

  export let data: { repo_naddr: string }
  let repo_naddr = data.repo_naddr

  let status: number = proposal_status_open
  $: name = selectedRepoCollectionToName($selected_repo_collection)
  $: filtered = $selected_prs.filter((s) => s.status === status)
</script>

<svelte:head>
  <title>GitWorkshop: {name} - proposals</title>
</svelte:head>

<RepoPageWrapper {repo_naddr} selected_tab="proposals">
  <div class="mt-2 border border-base-400">
    <div class="flex bg-slate-900">
      <div class="tabs tabs-lifted tabs-xs flex-none p-2">
        <button
          role="tab"
          class="tab"
          class:opacity-50={status !== proposal_status_open}
          class:font-bold={status == proposal_status_open}
          on:click={() => {
            status = proposal_status_open
          }}
        >
          {$selected_prs.filter((s) => s.status === proposal_status_open)
            .length} Open
        </button>
        <button
          role="tab"
          class="tab"
          class:opacity-50={status !== proposal_status_draft}
          class:font-bold={status == proposal_status_draft}
          on:click={() => {
            status = proposal_status_draft
          }}
        >
          {$selected_prs.filter((s) => s.status === proposal_status_draft)
            .length} Draft
        </button>
        <button
          role="tab"
          class="tab"
          class:opacity-50={status !== proposal_status_applied}
          class:font-bold={status == proposal_status_applied}
          on:click={() => {
            status = proposal_status_applied
          }}
        >
          {$selected_prs.filter((s) => s.status === proposal_status_applied)
            .length} Merged
        </button>
        <button
          role="tab"
          class="tab"
          class:opacity-50={status !== proposal_status_closed}
          class:font-bold={status == proposal_status_closed}
          on:click={() => {
            status = proposal_status_closed
          }}
        >
          {$selected_prs.filter((s) => s.status === proposal_status_closed)
            .length} Closed
        </button>
      </div>
    </div>
    {#if filtered.length === 0}
      <div class="py-10 text-center lowercase">
        can't find any {statusKindtoText(status, 'proposal')} proposals
      </div>
    {:else}
      <ProposalsList
        repo_naddr_override={repo_naddr}
        proposals_or_issues={filtered}
        loading={isRepoLoading($selected_repo_collection)}
      />
    {/if}
  </div>
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
      <h3 class="prose mb-2 text-sm font-bold">want to submit a proposal?</h3>
      <p class="prose text-xs">
        1) <a href="/ngit">install ngit</a> 2) clone with the nostr url 3) push
        a new branch with the
        <span class="rounded bg-neutral p-1 font-mono"
          ><span class="py-3">pr/</span></span
        > prefix
      </p>
    </div>
  </div>
</RepoPageWrapper>
