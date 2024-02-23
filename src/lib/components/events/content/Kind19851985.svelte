<script lang="ts">
  import type { NDKTag } from '@nostr-dev-kit/ndk'
  import Status from '$lib/components/proposals/Status.svelte'

  export let tags: NDKTag[] = []

  function extractTagContent(name: string): string | undefined {
    let tag = tags.find((tag) => tag[0] === name)
    return tag ? tag[1] : undefined
  }
  let status: string | undefined
  $: {
    status = extractTagContent('l')
  }
</script>

<div class="">
  {#if status}
    set status to <Status {status} />
  {:else}
    set status incorrectly
  {/if}
</div>
