<script lang="ts">
  import Status from '$lib/components/proposals/Status.svelte'

  export let type: 'proposal' | 'issue' = 'proposal'
  export let status: number | undefined
</script>

<div class="">
  {#if status}
    set status to <Status {type} {status} />
  {:else}
    set status incorrectly
  {/if}
</div>
