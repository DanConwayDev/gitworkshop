<script lang="ts">
  import { getName, type User } from './type'

  export let user: User = {
    hexpubkey: '',
    npub: '',
    loading: true,
  }

  export let inline = false
  export let size: 'xs' | 'sm' | 'md' = 'md'
  export let avatar_only = false

  $: ({ profile, loading } = user)
  $: display_name = getName(user)
</script>

<div class:inline-block={inline}>
  <div
    class:my-2={!inline}
    class:text-xs={size === 'xs'}
    class:text-sm={size === 'sm'}
    class:text-md={size === 'md'}
    class:align-middle={inline}
    class:flex={!inline}
    class:items-center={!inline}
  >
    <div
      class="avatar"
      class:inline-block={inline}
      class:align-middle={inline}
      class:flex-none={!inline}
    >
      <div
        class:inline-block={inline}
        class:h-8={!inline && size === 'md'}
        class:w-8={!inline && size === 'md'}
        class:h-4={!inline && size === 'sm'}
        class:w-4={!inline && size === 'sm'}
        class:h-5={inline && size === 'md'}
        class:w-5={inline && size === 'md'}
        class:h-3.5={(inline && size === 'sm') || size === 'xs'}
        class:w-3.5={(inline && size === 'sm') || size === 'xs'}
        class="rounded"
        class:skeleton={!profile && loading}
        class:bg-neutral={!loading && (!profile || !profile.image)}
      >
        {#if profile && profile?.image}
          <img class="my-0" src={profile?.image} alt={display_name} />
        {/if}
      </div>
    </div>
    <div
      class:pl-3={!inline && size === 'md'}
      class:pl-2={!inline && (size === 'sm' || size === 'xs')}
      class:pl-0={inline}
      class:flex-auto={!inline}
      class:m-auto={!inline}
      class:inline-block={inline}
      class:hidden={avatar_only}
    >
      {#if loading}
        <div
          class="skeleton w-24"
          class:h-4={size === 'md'}
          class:h-3={size === 'sm'}
          class:h-2.5={size === 'xs'}
        ></div>
      {:else}
        {display_name}
      {/if}
    </div>
  </div>
</div>
