<script lang="ts">
  import { getName, type User } from './type'

  export let user: User = {
    hexpubkey: '',
    npub: '',
    loading: true,
  }

  export let inline = false

  $: ({ profile, loading } = user)
  $: display_name = getName(user)
</script>

<div class:inline-block={inline}>
  <div class:my-2={!inline} class="flex items-center">
    <div class="avatar flex-none">
      <div
        class:h-8={!inline}
        class:w-8={!inline}
        class:h-5={inline}
        class:w-5={inline}
        class="rounded"
        class:skeleton={!profile && loading}
        class:bg-neutral={!loading && (!profile || !profile.image)}
      >
        {#if profile && profile?.image}
          <img class="my-0" src={profile?.image} alt={display_name} />
        {/if}
      </div>
    </div>
    <div class:pl-3={!inline} class:pl-1={inline} class="m-auto flex-auto pl-3">
      {#if loading}
        <div class="skeleton h-4 w-24"></div>
      {:else}
        {display_name}
      {/if}
    </div>
  </div>
</div>
