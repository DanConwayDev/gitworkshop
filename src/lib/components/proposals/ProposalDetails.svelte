<script lang="ts">
  import UserHeader from '../users/UserHeader.svelte'
  import StatusSelector from './StatusSelector.svelte'
  import type { IssueOrPrWithReferences } from '$lib/dbs/types'
  import type { Writable } from 'svelte/store'

  export let type: 'proposal' | 'issue' = 'proposal'
  export let issue_or_pr: Writable<IssueOrPrWithReferences | undefined>
  let labels: string[] = []
</script>

<div class="max-w-md">
  <div>
    {#if !$issue_or_pr}
      <div class="skeleton my-3 h-5 w-20"></div>
      <div class="badge skeleton my-2 block w-60"></div>
      <div class="badge skeleton my-2 block w-40"></div>
    {:else}
      <h4>Author</h4>
      <UserHeader user={$issue_or_pr.author} />
    {/if}
  </div>

  <div>
    {#if !$issue_or_pr}
      <div class="skeleton my-3 h-5 w-20"></div>
      <div class="badge skeleton my-2 block w-60"></div>
      <div class="badge skeleton my-2 block w-40"></div>
    {:else}
      <h4>Status</h4>
      <StatusSelector
        {type}
        status={$issue_or_pr.status}
        proposal_or_issue_id={$issue_or_pr.uuid}
      />
    {/if}
  </div>

  <div>
    {#if !$issue_or_pr}
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
