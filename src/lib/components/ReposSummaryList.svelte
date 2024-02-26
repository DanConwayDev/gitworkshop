<script lang="ts">
  import type { RepoSummary } from './repo/type'
  import RepoSummaryCard from '$lib/components/RepoSummaryCard.svelte'

  export let title: string = ''
  export let repos: RepoSummary[] = []
  export let loading: boolean = false
</script>

<div class="min-width">
  {#if title.length > 0}
    <div class="prose mb-3">
      <h3>{title}</h3>
    </div>
  {/if}
  {#if repos.length == 0 && !loading}
    <p class="prose">None</p>
  {:else}
    <div class="">
      {#each repos as { name, description, identifier, maintainers }}
        <RepoSummaryCard {name} {description} {identifier} {maintainers} />
      {/each}
      {#if loading}
        <RepoSummaryCard loading={true} />
        {#if repos.length == 0}
          <RepoSummaryCard loading={true} />
          <RepoSummaryCard loading={true} />
        {/if}
      {/if}
    </div>
  {/if}
</div>
