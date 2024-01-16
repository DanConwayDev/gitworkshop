<script lang="ts">
  import Container from "./Container.svelte";

  export let nip07plugin: boolean = false;
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
        {#if !nip07plugin}
          <div class="btn normal-case btn-sm btn-ghost">Sign up</div>
        {:else}
          <button class="btn normal-case btn-sm btn-ghost">Login</button>
        {/if}
      </div>
    </div>
  </Container>
</div>
