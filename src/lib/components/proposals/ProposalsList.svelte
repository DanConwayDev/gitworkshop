<script lang="ts">
  import ProposalsListItem from '$lib/components/proposals/ProposalsListItem.svelte'
  import type { ProposalSummary } from './type'

  export let title: string = ''
  export let proposals: ProposalSummary[] = []
  export let loading: boolean = false
  export let show_repo: boolean = false
  export let limit: number = 0
  export let allow_more = true
  let current_limit = limit
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
  <ul class=" divide-y divide-base-400">
    {#each proposals as proposal, index}
      {#if current_limit === 0 || index + 1 <= current_limit}
        <ProposalsListItem {...proposal} {show_repo} />
      {/if}
    {/each}
    {#if loading}
      <ProposalsListItem loading={true} />
      {#if proposals.length == 0}
        <ProposalsListItem loading={true} />
        <ProposalsListItem loading={true} />
      {/if}
    {:else if allow_more && limit !== 0 && proposals.length > current_limit}
      <button
        on:click={() => {
          current_limit = current_limit + 5
        }}
        class="btn mt-3 p-3 font-normal">more</button
      >
    {/if}
  </ul>
</div>
