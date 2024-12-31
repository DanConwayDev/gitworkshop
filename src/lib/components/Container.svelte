<script lang="ts">
  export let no_wrap: boolean = false
</script>

<div class="mx-auto lg:container">
  {#if no_wrap}
    <slot />
  {:else}
    <div class="px-3">
      <slot />
    </div>
  {/if}
</div>
