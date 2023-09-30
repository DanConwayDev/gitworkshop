<script lang="ts">
  import { fade } from "svelte/transition";
  import { onMount } from "svelte";

  import RepoSummaryCard, {
    type Args as RepoSummaryCardArgs,
  } from "$lib/components/RepoSummaryCard.svelte";

  export let title: string = "";
  export let repos: RepoSummaryCardArgs[] = [];
  export let loading: boolean = false;
</script>

<div class="space-y-5">
  {#if title.length > 0}
    <div class="prose">
      <h3>{title}</h3>
    </div>
  {/if}
  {#if repos.length == 0 && !loading}
    <p class="prose">None</p>
  {/if}
  {#each repos as { name, description }}
    <RepoSummaryCard {name} {description} />
  {/each}
  {#if loading}
    <RepoSummaryCard loading={true} />
    {#if repos.length == 0}
      <RepoSummaryCard loading={true} />
      <RepoSummaryCard loading={true} />
    {/if}
  {/if}
</div>
