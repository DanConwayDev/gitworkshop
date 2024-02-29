<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk'
  import ThreadTree from './ThreadTree.svelte'
  import { getThreadTrees } from './thread_tree'

  export let event: NDKEvent
  export let type: 'proposal' | 'issue' = 'proposal'
  export let show_compose = true

  export let replies: NDKEvent[] | undefined = undefined

  $: thread_trees = getThreadTrees(type, event, replies)
</script>

{#each thread_trees as tree, i}
  {#if i > 0}
    <div class="divider">new revision</div>
  {/if}
  <ThreadTree
    {type}
    {tree}
    show_compose={show_compose && thread_trees.length - 1 === i}
  />
{/each}
