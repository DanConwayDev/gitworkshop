<script lang="ts" context="module">
  export const defaults: User = {
    hexpubkey: '',
    npub: '',
    loading: true,
  }
</script>

<script lang="ts">
  import { getName, type User } from './type'

  export let user: User = defaults
  let { profile, loading } = user
  $: display_name = getName(user)
</script>

<div class="my-2 flex">
  <div class="avatar flex-none">
    <div
      class="h-8 w-8 rounded"
      class:skeleton={!profile && loading}
      class:bg-neutral={!loading && (!profile || !profile.image)}
    >
      {#if profile && profile.image}
        <img class="my-0" src={profile.image} alt={display_name} />
      {/if}
    </div>
  </div>
  <div class="m-auto flex-auto pl-3">
    {#if loading}
      <div class="skeleton h-4 w-24"></div>
    {:else}
      {display_name}
    {/if}
  </div>
</div>
