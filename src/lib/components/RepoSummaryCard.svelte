<script lang="ts">
  import { summary_defaults } from './repo/type'
  import UserHeader from './users/UserHeader.svelte'

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

<div
  class=" my-2 rounded-lg bg-base-200 p-4"
  style={`min-height: ${maintainers.length * 1.325 + 2}rem;`}
>
  {#if loading}
    <div class="skeleton mb-2 h-5 w-40"></div>
    <div class="w-100 skeleton h-4"></div>
  {:else}
    <p class="text-muted float-right break-words text-sm">
      <span></span>
      {#each maintainers as user}
        <div class="text-right">
          <UserHeader {user} inline={true} size="sm" />
        </div>
      {/each}
    </p>
    <a class="link-primary break-words" href="/repo/{encodeURI(repo_id)}"
      >{short_name}</a
    >
    <p class="text-muted break-words text-sm">
      {short_descrption}
    </p>
  {/if}
</div>
