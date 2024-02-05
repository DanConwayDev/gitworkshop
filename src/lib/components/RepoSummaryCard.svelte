<script lang="ts">
  import { summary_defaults } from './repo/type'

  export let { name, description, repo_id, maintainers, loading } =
    summary_defaults
  let short_name: string
  $: {
    if (name.length > 45) short_name = name.slice(0, 45) + '...'
    else if (name.length == 0) short_name = 'Untitled'
    else short_name = name
  }
  $: short_descrption =
    description.length > 50 ? description.slice(0, 45) + '...' : description
</script>

<div class="my-2 rounded-lg bg-base-200 p-4">
  {#if loading}
    <div class="skeleton mb-2 h-5 w-40"></div>
    <div class="w-100 skeleton h-4"></div>
  {:else}
    <a class="link-primary break-words" href="/repo/{repo_id}">{short_name}</a>
    <p class="text-muted break-words text-sm">{short_descrption}</p>
  {/if}
</div>
