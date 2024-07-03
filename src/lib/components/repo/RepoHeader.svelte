<script lang="ts">
  import RepoMenu from '$lib/wrappers/RepoMenu.svelte'
  import UserHeader from '$lib/components/users/UserHeader.svelte'
  import Container from '../Container.svelte'
  import { event_defaults, type RepoPage } from './type'

  export let {
    event_id,
    identifier,
    naddr,
    unique_commit,
    name,
    author,
    description,
    clone,
    web,
    tags,
    maintainers,
    relays,
    referenced_by,
    created_at,
    most_recent_reference_timestamp,
    loading,
  } = event_defaults
  export let selected_tab: RepoPage = 'about'
  let short_name: string
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
  <Container no_wrap={true}>
    {#if loading}
      <div class="p-3">
        <div class="skeleton h-6 w-28 bg-base-200"></div>
      </div>
    {:else}
      <a
        href={`/r/${naddr}`}
        class="strong btn btn-ghost mb-0 mt-0 break-words px-3 text-sm"
        >{short_name}</a
      >
      {#if created_at === 0 && name.length === 0}
        <span class="text-xs text-warning">
          cannot find referenced repository event by <UserHeader user={author} inline />
        </span>    
      {/if}
    {/if}
    <RepoMenu {selected_tab} />
  </Container>
</div>
