<script lang="ts">
  import RepoMenu from '$lib/wrappers/RepoMenu.svelte'
  import UserHeader from '$lib/components/users/UserHeader.svelte'
  import Container from '../Container.svelte'
  import {
    isRepoLoading,
    selectedRepoCollectionToLeadMaintainer,
    selectedRepoCollectionToName,
    selectedRepoIsAddressPointerWithLoading,
    type SelectedRepoCollection,
  } from '$lib/dbs/types'
  import type { RepoPage } from './type'

  export let repo_collection: SelectedRepoCollection = undefined
  export let selected_tab: RepoPage = 'about'
  let short_name: string
  $: name = selectedRepoCollectionToName(repo_collection)
  $: identifier = !repo_collection ? '' : repo_collection.identifier
  $: loading = isRepoLoading(repo_collection)
  $: {
    if (name && name.length > 45) short_name = name.slice(0, 45) + '...'
    else if (name && name.length >= 0) short_name = name
    else if (identifier && identifier.length > 45)
      short_name = identifier.slice(0, 45) + '...'
    else if (identifier && identifier.length >= 0) short_name = identifier
    else short_name = 'Untitled'
  }
</script>

<div class="border-b border-accent-content bg-base-300">
  {#if repo_collection}
    <Container no_wrap={true}>
      {#if loading}
        <div class="p-3">
          <div class="skeleton h-6 w-28 bg-base-200"></div>
        </div>
      {:else}
        <a
          href={`/r/${repo_collection.naddr}`}
          class="strong btn btn-ghost mb-0 mt-0 break-words px-3 text-sm"
          >{short_name}</a
        >
        {#if selectedRepoIsAddressPointerWithLoading(repo_collection) && !repo_collection.loading}
          <span class="text-xs text-warning">
            cannot find referenced repository event by <div
              class="badge bg-base-400 text-warning"
            >
              <UserHeader
                user={selectedRepoCollectionToLeadMaintainer(repo_collection)}
                inline
                size="xs"
              />
            </div>
          </span>
        {/if}
      {/if}
      <RepoMenu {selected_tab} />
    </Container>
  {/if}
</div>
