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
  import RepoPageWrapper from '$lib/wrappers/RepoPageWrapper.svelte'

  export let data: { repo_id: string }
  let identifier = data.repo_id
  let status: number = proposal_status_open
  let filtered: IssueSummary[] = []
  $: filtered = $issue_summaries.summaries.filter((s) => s.status === status)
</script>

<RepoPageWrapper {identifier} selected_tab="issues">
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
    {#if !$issue_summaries.loading && filtered.length === 0}
      <div class="py-10 text-center lowercase">
        there aren't any {statusKindtoText(status, 'issue')} issues
      </div>
    {:else}
      <ProposalsList
        proposals_or_issues={filtered}
        loading={$issue_summaries.loading}
      />
    {/if}
  </div>
  <a class="btn btn-success my-3" href="/repo/{identifier}/issues/new">
    create issue
  </a>
</RepoPageWrapper>
