<script lang="ts">
  import type { PubKeyString } from '$lib/dbs/types'
  import { logout } from '$lib/stores/users'
  import Container from './Container.svelte'
  import UserHeader from './users/UserHeader.svelte'

  export let logged_in_user: PubKeyString | undefined = undefined
  export let nip07_plugin: boolean | undefined = undefined
  export let login_function = () => {}
  export let singup_function = () => {}
</script>

<div class="bg-base-400">
  <Container>
    <div class="navbar">
      <div class="navbar-start">
        <a class="h-8 overflow-hidden align-middle" href="/">
          <img
            src="/icons/icon.svg"
            alt="gitworkshop.dev logo"
            class="h-full max-w-full"
          />
        </a>
      </div>
      <div class="navbar-center"></div>
      <div class="navbar-end gap-4">
        <a href="/repos" class="btn btn-ghost btn-sm normal-case">Repos</a>
        <a href="/quick-start" class="btn btn-ghost btn-sm normal-case"
          >Quick Start</a
        >
        {#if logged_in_user}
          <div class="dropdown dropdown-end">
            <div tabindex="0" role="button" class="m-1">
              <UserHeader
                user={logged_in_user}
                link_to_profile={false}
                avatar_on_right
              />
            </div>
            <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
            <ul
              tabindex="0"
              class="menu dropdown-content z-[1] -mr-4 rounded-box bg-base-400 p-2 shadow"
            >
              <li><UserHeader user={logged_in_user} /></li>
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <!-- svelte-ignore a11y-missing-attribute -->
              <li>
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <a
                  on:click={() => {
                    logout()
                  }}>Logout</a
                >
              </li>
            </ul>
          </div>
        {:else if nip07_plugin === undefined}
          <div class="skeleton h-8 w-20"></div>
        {:else if nip07_plugin}
          <button
            on:click={() => {
              login_function()
            }}
            class="btn btn-ghost btn-sm normal-case">Login</button
          >
        {:else}
          <button
            on:click={() => {
              singup_function()
            }}
            class="btn btn-ghost btn-sm normal-case">Sign up</button
          >
        {/if}
      </div>
    </div>
  </Container>
</div>
