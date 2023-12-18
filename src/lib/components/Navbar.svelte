<script lang="ts">
  export let nip07plugin: boolean = false;
</script>

<div class="bg-neutral">
  <div class="mx-auto lg:container bg-neutral">
    <div class="navbar">
      <div class="flex-1">
        <h4>
          <span class="primary">git</span>
          <span class="">together</span>
          <span class="">.xyz</span>
        </h4>
      </div>
      <div class="flex-none gap-4">
        {#if !nip07plugin}
          <div class="btn btn-primary normal-case">Sign up</div>
        {/if}
        <button class="btn btn-outline normal-case">Login</button>
      </div>
    </div>
  </div>
</div>
