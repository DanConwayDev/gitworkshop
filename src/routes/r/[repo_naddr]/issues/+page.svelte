<script lang="ts">
  import type { IssueSummary } from '$lib/components/issues/type'
  import ProposalsList from '$lib/components/proposals/ProposalsList.svelte'
  import {
    proposal_status_applied,
    proposal_status_closed,
    proposal_status_open,
    statusKindtoText,
  } from '$lib/kinds'
  import { issue_summaries } from '$lib/stores/Issues'
  import { selected_repo_event } from '$lib/stores/repo'
  import RepoPageWrapper from '$lib/wrappers/RepoPageWrapper.svelte'

  export let data: { repo_naddr: string }
  let repo_naddr = data.repo_naddr
  let status: number = proposal_status_open
  let filtered: IssueSummary[] = []
  $: filtered = $issue_summaries.summaries.filter((s) => s.status === status)
</script>

<svelte:head>
  <title>GitWorkshop: {$selected_repo_event.name} - issues</title>
</svelte:head>

<RepoPageWrapper {repo_naddr} selected_tab="issues">
  <div class="mt-2 rounded-tr-lg border border-base-400">
    <div class="flex rounded-r-lg bg-slate-900">
      <div class="flex-none">
        <div class="tabs tabs-lifted tabs-xs p-2">
          <button
            role="tab"
            class="tab"
            class:opacity-50={status !== proposal_status_open}
            class:font-bold={status == proposal_status_open}
            on:click={() => {
              status = proposal_status_open
            }}
          >
            {$issue_summaries.summaries.filter(
              (s) => s.status === proposal_status_open
            ).length} Open
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
            {$issue_summaries.summaries.filter(
              (s) => s.status === proposal_status_applied
            ).length} Completed
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
            {$issue_summaries.summaries.filter(
              (s) => s.status === proposal_status_closed
            ).length} Closed
          </button>
        </div>
      </div>
      <div class="flex-auto"></div>
      <div class="flex-none">
        <a
          class="btn btn-success btn-sm h-full text-base-400"
          href={`/r/${repo_naddr}/issues/new`}
        >
          create issue
        </a>
      </div>
    </div>
    {#if !$issue_summaries.loading && filtered.length === 0}
      <div class="py-10 text-center lowercase">
        can't find any {statusKindtoText(status, 'issue')} issues
      </div>
    {:else}
      <ProposalsList
        repo_naddr_override={repo_naddr}
        proposals_or_issues={filtered}
        loading={$issue_summaries.loading}
      />
    {/if}
  </div>
</RepoPageWrapper>
