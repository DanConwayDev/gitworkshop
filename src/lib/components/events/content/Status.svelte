<script lang="ts">
  import Status from '$lib/components/proposals/Status.svelte'

  export let status: number | undefined
</script>

<div class="">
  {#if status}
    set status to <Status {status} />
  {:else}
    set status incorrectly
  {/if}
</div>
