<script lang="ts">
  import Container from "./Container.svelte";
  import UserHeader from "./users/UserHeader.svelte";
  import type { User } from "./users/type";

  export let logged_in_user: User | undefined = undefined;
  export let nip07_plugin: boolean | undefined = undefined;
  export let login_function: Function = () => {};
  export let singup_function: Function = () => {};
</script>

<div class="bg-base-400">
  <Container>
    <div class="navbar">
      <div class="navbar-start"></div>
      <div class="navbar-center">
        <a class="align-middle text-lg" href="/">
          <span class="text-purple-600">git</span><span class="text-white"
            >workshop</span
          ><span class="text-neutral">.io</span>
        </a>
      </div>
      <div class="navbar-end gap-4">
        {#if logged_in_user}
          <UserHeader user={logged_in_user} />
        {:else if nip07_plugin === undefined}
          <div class="h-8 skeleton w-20"></div>
        {:else if nip07_plugin}
          <button
            on:click={() => {
              login_function();
            }}
            class="btn normal-case btn-sm btn-ghost">Login</button
          >
        {:else}
          <button
            on:click={() => {
              singup_function();
            }}
            class="btn normal-case btn-sm btn-ghost">Sign up</button
          >
        {/if}
      </div>
    </div>
  </Container>
</div>
