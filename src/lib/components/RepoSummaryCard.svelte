<script lang="ts">
  import { summary_defaults } from './repo/type'
  import UserHeader from './users/UserHeader.svelte'

  export let { name, description, identifier, maintainers, naddr, loading } =
    summary_defaults
  let short_name: string
  $: {
    if (name && name.length > 45) short_name = name.slice(0, 45) + '...'
    else if (name && name.length >= 0) short_name = name
    else if (identifier && identifier.length > 45)
      short_name = identifier.slice(0, 45) + '...'
    else if (identifier && identifier.length >= 0) short_name = identifier
    else short_name = 'Untitled'
  }
  $: short_descrption =
    description.length > 50 ? description.slice(0, 45) + '...' : description
</script>

<div
  class="rounded-lg bg-base-200 p-4"
  style={`min-height: ${maintainers.length * 1.325 + 2}rem;`}
>
  {#if loading}
    <div class="skeleton mb-2 h-5 w-40"></div>
    <div class="w-100 skeleton h-4"></div>
  {:else}
    <a class="link-primary break-words" href="/r/{naddr}">{short_name}</a>
    {#if short_descrption.length > 0}
      <p class="text-muted break-words pb-1 text-sm">
        {short_descrption}
      </p>
    {/if}

    <div class="break-words text-right text-xs text-slate-400">
      <ul class="reposummarycard inline">
        {#each maintainers as user}
          <li class="inline">
            <UserHeader {user} inline={true} size="xs" />
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style lang="postcss">
  .reposummarycard li::before {
    content: ', ';
  }
  .reposummarycard li:last-child::before {
    content: ' or ';
  }
  .reposummarycard li:first-child::before {
    content: '';
  }
</style>
