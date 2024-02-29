<script lang="ts">
  import Container from './Container.svelte'
  import UserHeader from './users/UserHeader.svelte'
  import type { User } from './users/type'

  export let logged_in_user: User | undefined = undefined
  export let nip07_plugin: boolean | undefined = undefined
  export let login_function = () => {}
  export let singup_function = () => {}
</script>

<div class="bg-base-400">
  <Container>
    <div class="navbar">
      <div class="navbar-start">
        <a href="/about" class="btn btn-ghost btn-sm normal-case">About</a>
      </div>
      <div class="navbar-center">
        <a class="align-middle text-lg" href="/">
          <span class="text-purple-600">git</span><span class="text-white"
            >workshop</span
          ><span class="text-neutral">.dev</span>
        </a>
      </div>
      <div class="navbar-end gap-4">
        {#if logged_in_user}
          <UserHeader user={logged_in_user} />
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
