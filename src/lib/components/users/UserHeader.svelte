<script lang="ts">
  import { ensureUser } from '$lib/stores/users'
  import type { Unsubscriber } from 'svelte/store'
  import { defaults, getName, type User, type UserObject } from './type'
  import { onDestroy } from 'svelte'
  import { goto } from '$app/navigation'
  import ParsedContent from '../events/content/ParsedContent.svelte'
  import CopyField from '../CopyField.svelte'
  import { icons_misc } from '../icons'

  export let user: User = {
    ...defaults,
  }

  export let inline = false
  export let size: 'xs' | 'sm' | 'md' | 'full' = 'md'
  export let avatar_only = false
  export let in_event_header = false
  export let link_to_profile = true

  let user_object: UserObject = {
    ...defaults,
  }
  let unsubscriber: Unsubscriber
  $: {
    if (typeof user === 'string') {
      if (unsubscriber) unsubscriber()
      unsubscriber = ensureUser(user).subscribe((u) => {
        user_object = { ...u }
      })
    } else user_object = user
  }
  onDestroy(() => {
    if (unsubscriber) unsubscriber()
  })
  $: ({ profile, loading } = user_object)
  $: display_name = getName(user_object)
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
  class:inline-block={inline}
  class:cursor-pointer={link_to_profile}
  on:click={() => {
    if (link_to_profile) goto(`/p/${user_object.npub}`)
  }}
>
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
        class:h-32={!inline && size === 'full'}
        class:w-32={!inline && size === 'full'}
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
      class:text-xl={size === 'full'}
      class:width-max-prose={size === 'full'}
      class:pl-4={!inline && size === 'full'}
      class:pl-3={!inline && size === 'md'}
      class:pl-2={!inline && (size === 'sm' || size === 'xs')}
      class:pl-0={inline}
      class:flex-auto={!inline}
      class:m-auto={!inline}
      class:inline-block={inline}
      class:hidden={avatar_only}
      class:opacity-40={in_event_header}
    >
      {#if loading}
        <div
          class="skeleton w-24"
          class:h-4={size === 'md'}
          class:h-3={size === 'sm'}
          class:h-2.5={size === 'xs'}
        ></div>
      {:else}
        <span class:font-bold={in_event_header || size === 'full'}
          >{display_name}</span
        >
      {/if}
      {#if size === 'full'}
        <CopyField
          icon={icons_misc.key}
          content={user_object.npub}
          no_border
          truncate={[10, 10]}
        />
        {#if profile && profile.lud16}
          <CopyField
            icon={icons_misc.lightning}
            content={profile.lud16}
            no_border
          />
        {/if}
        {#if profile && profile.website}
          <a
            href={profile.website}
            target="_blank"
            class="items items-top mt-1 flex w-full opacity-60"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              class="mr-1 inline h-4 w-4 flex-none fill-base-content opacity-50"
            >
              {#each icons_misc.link as d}
                <path {d} />
              {/each}
            </svg>
            <div class="link-secondary text-sm">{profile.website}</div>
          </a>
        {/if}
        {#if size === 'full' && profile && profile.about}
          <div class="items items-top flex max-w-md opacity-60">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              class="mr-1 mt-1 inline h-4 w-4 flex-none fill-base-content opacity-50"
            >
              {#each icons_misc.info as d}
                <path {d} />
              {/each}
            </svg>

            {#if loading}
              <div class="w.max-lg skeleton h-3"></div>
            {:else}
              <div class="text-sm">
                <ParsedContent content={profile?.about} />
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>
