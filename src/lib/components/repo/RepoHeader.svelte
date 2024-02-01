<script lang="ts">
  import Container from '../Container.svelte'
  import { defaults } from './type'

  export let {
    repo_id,
    name,
    description,
    git_server,
    tags,
    maintainers,
    relays,
    loading,
  } = defaults
  let short_name: string
  $: {
    if (name.length > 45) short_name = name.slice(0, 45) + '...'
    else if (name.length == 0) short_name = 'Untitled'
    else short_name = name
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
        href={`/repo/${repo_id}`}
        class="strong btn btn-ghost mb-0 mt-0 break-words px-3 text-sm"
        >{short_name}</a
      >
    {/if}
  </Container>
</div>
