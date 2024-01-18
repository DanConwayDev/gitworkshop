<script lang="ts">
  import {
    checkForNip07Plugin,
    logged_in_user,
    login,
    nip07_plugin,
  } from "$lib/stores/users";
  import { onMount } from "svelte";
  import Container from "./Container.svelte";
  import UserHeader from "./users/UserHeader.svelte";

  onMount(checkForNip07Plugin);
</script>

<div class="bg-base-400">
  <Container>
    <div class="navbar">
      <div class="navbar-start"></div>
      <div class="navbar-center">
        <h4 class="align-middle text-sm font-mono">
          <span class="text-primary">git</span><span class="text-primary"
            >workshop</span
          ><span class="">.net</span>
        </h4>
      </div>
      <div class="navbar-end gap-4">
        {#if $logged_in_user}
          <UserHeader user={$logged_in_user} />
        {:else if $nip07_plugin === undefined}
          <div class="h-8 skeleton w-20"></div>
        {:else if $nip07_plugin}
          <button
            on:click={() => {
              login();
            }}
            class="btn normal-case btn-sm btn-ghost">Login</button
          >
        {:else}
          <div class="btn normal-case btn-sm btn-ghost">Sign up</div>
        {/if}
      </div>
    </div>
  </Container>
</div>
