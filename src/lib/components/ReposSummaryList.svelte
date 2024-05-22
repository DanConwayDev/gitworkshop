<script lang="ts">
  import type { RepoSummary } from './repo/type'
  import RepoSummaryCard from '$lib/components/RepoSummaryCard.svelte'

  export let title: string = ''
  export let repos: RepoSummary[] = []
  export let loading: boolean = false
  export let group_by: 'name' | 'identifier' | undefined = undefined

  let grouped_repos: RepoSummary[][] = []
  let selected_group: string | undefined = undefined
  $: {
    grouped_repos = []
    repos.forEach((collection) => {
      if (!group_by) {
        grouped_repos.push([collection])
        return
      }
      const added_to_group = grouped_repos.some((group, i) => {
        if (group.some((c) => c[group_by] === collection[group_by])) {
          grouped_repos[i].push(collection)
          return true
        }
        return false
      })
      if (!added_to_group) grouped_repos.push([collection])
    })
  }
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
    <div class="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {#each grouped_repos as group}
        {#if group.length === 0}
          <RepoSummaryCard loading={true} />
        {:else if group.length === 1}
          {#each group as { name, description, identifier, maintainers, naddr }}
            <RepoSummaryCard
              {name}
              {description}
              {identifier}
              {maintainers}
              {naddr}
            />
          {/each}
        {:else if group_by}
          <div class="stack">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
              class="flex min-h-28 cursor-pointer items-center rounded-lg border border-base-400 bg-base-200 p-4 hover:bg-base-300"
              on:click={() => {
                selected_group = group[0][group_by]
              }}
            >
              <div class="m-auto text-center">
                <div class="">{group[0][group_by]}</div>
                <div class=" text-sm opacity-50">{group.length} Items</div>
              </div>
            </div>
            {#each group as { name, description, identifier, maintainers, naddr }}
              <div class="rounded-lg border border-base-400">
                <RepoSummaryCard
                  {name}
                  {description}
                  {identifier}
                  {maintainers}
                  {naddr}
                />
              </div>
            {/each}
          </div>
        {/if}
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
{#if selected_group}
  <div class="modal modal-open">
    <div class="modal-box max-w-full text-wrap text-xs">
      <div class="prose max-w-full">
        <h3 class="mb-3 max-w-full text-center">
          {group_by}: "{selected_group}"
        </h3>
      </div>
      <div class="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {#each repos.filter((summary) => group_by && summary[group_by] === selected_group) as { name, description, identifier, maintainers, naddr }}
          <RepoSummaryCard
            {name}
            {description}
            {identifier}
            {maintainers}
            {naddr}
          />
        {/each}
      </div>
      <div class="modal-action">
        <button class="btn btn-sm" on:click={() => (selected_group = undefined)}
          >Close</button
        >
      </div>
    </div>
  </div>
{/if}
