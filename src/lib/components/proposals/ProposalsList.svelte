<script lang="ts">
  import ProposalsListItem from '$lib/components/proposals/ProposalsListItem.svelte'
  import type { ProposalSummary } from './type'

  export let title: string = ''
  export let proposals: ProposalSummary[] = []
  export let loading: boolean = false
</script>

<div class="">
  {#if title.length > 0}
    <div class="prose">
      <h4>{title}</h4>
    </div>
  {/if}
  {#if proposals.length == 0 && !loading}
    <p class="prose">None</p>
  {/if}
  <ul class=" divide-y divide-neutral-600">
    {#each proposals as proposal}
      <ProposalsListItem {...proposal} />
    {/each}
    {#if loading}
      <ProposalsListItem loading={true} />
      {#if proposals.length == 0}
        <ProposalsListItem loading={true} />
        <ProposalsListItem loading={true} />
      {/if}
    {/if}
  </ul>
</div>
