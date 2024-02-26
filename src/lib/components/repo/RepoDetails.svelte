<script lang="ts">
  import UserHeader from '$lib/components/users/UserHeader.svelte'
  import { event_defaults } from './type'

  export let {
    event_id,
    identifier,
    unique_commit,
    name,
    description,
    clone,
    web,
    tags,
    maintainers,
    relays,
    referenced_by,
    created_at,
    loading,
  } = event_defaults
  $: short_descrption =
    description.length > 500 ? description.slice(0, 450) + '...' : description
</script>

<div class="prose w-full max-w-md">
  {#if loading}
    <div class="skeleton my-3 h-5 w-20"></div>
    <div class="skeleton my-2 h-4"></div>
    <div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
  {:else if description.length == 0}
    <div />
  {:else}
    <h4>description</h4>
    <p class="my-2 break-words text-sm">{short_descrption}</p>
  {/if}
  <div>
    {#if loading}
      <div class="badge skeleton w-20"></div>
      <div class="badge skeleton w-20"></div>
    {:else}
      {#each tags as tag}
        <div class="badge badge-secondary mr-2">{tag}</div>
      {/each}
    {/if}
  </div>
  <div>
    {#if loading}
      <div class="skeleton my-3 h-5 w-20"></div>
      <div class="badge skeleton my-2 block w-60"></div>
    {:else if clone.length == 0}
      <div />
    {:else}
      <h4>clone</h4>
      <a
        href={clone}
        target="_blank"
        class="link link-primary my-2 break-words"
      >
        {clone}
      </a>
    {/if}
  </div>
  <div>
    {#if loading}
      <div class="skeleton my-3 h-5 w-20"></div>
      <div class="badge skeleton my-2 block w-60"></div>
      <div class="badge skeleton my-2 block w-40"></div>
    {:else if maintainers.length == 0}
      <div />
    {:else}
      <h4>maintainers</h4>
      {#each maintainers as maintainer}
        <UserHeader user={maintainer} />
      {/each}
    {/if}
  </div>
  <div>
    {#if loading}
      <div class="skeleton my-3 h-5 w-20"></div>
      <div class="badge skeleton my-2 block w-60"></div>
      <div class="badge skeleton my-2 block w-40"></div>
    {:else if relays.length == 0}
      <div />
    {:else}
      <h4>relays</h4>
      {#each relays as relay}
        <div class="badge badge-secondary my-2 block">{relay}</div>
      {/each}
    {/if}
  </div>
</div>
