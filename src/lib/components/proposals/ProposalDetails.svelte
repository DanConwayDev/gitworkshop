<script lang="ts">
  import { full_defaults, summary_defaults, type ProposalSummary } from './type'
  import UserHeader from '../users/UserHeader.svelte'
  import StatusSelector from './StatusSelector.svelte'
  import type { IssueSummary } from '../issues/type'

  export let type: 'proposal' | 'issue' = 'proposal'
  export let summary: ProposalSummary | IssueSummary = { ...summary_defaults }
  export let { labels, loading } = { ...full_defaults }
</script>

<div class="max-w-md">
  <div>
    {#if loading}
      <div class="skeleton my-3 h-5 w-20"></div>
      <div class="badge skeleton my-2 block w-60"></div>
      <div class="badge skeleton my-2 block w-40"></div>
    {:else}
      <h4>Author</h4>
      <UserHeader user={summary.author} />
    {/if}
  </div>

  <div>
    {#if loading}
      <div class="skeleton my-3 h-5 w-20"></div>
      <div class="badge skeleton my-2 block w-60"></div>
      <div class="badge skeleton my-2 block w-40"></div>
    {:else}
      <h4>Status</h4>
      <StatusSelector
        {type}
        status={summary.status}
        proposal_or_issue_id={summary.id}
      />
    {/if}
  </div>

  <div>
    {#if loading}
      <div class="badge skeleton w-20"></div>
      <div class="badge skeleton w-20"></div>
    {:else}
      <h4>Labels</h4>
      {#each labels as label}
        <div class="badge badge-secondary mr-2">{label}</div>
      {/each}
    {/if}
  </div>
</div>
