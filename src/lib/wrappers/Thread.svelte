<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk'
  import EventCard from './EventCard.svelte'
  import ThreadWrapper from '$lib/components/events/ThreadWrapper.svelte'
  import { writable } from 'svelte/store'
  import ComposeReply from './ComposeReply.svelte'
  import type { ThreadTreeNode } from '$lib/components/events/type'
  import ThreadTree from './ThreadTree.svelte'

  export let event: NDKEvent
  export let type: 'proposal' | 'issue' = 'proposal'

  export let replies: NDKEvent[] | undefined = undefined

  const getParentId = (reply: NDKEvent): string | undefined => {
    let t = reply.tags.find((tag) => tag.length === 4 && tag[3] === 'reply')
    return t ? t[1] : undefined
  }

  const createThreadTree = (replies: NDKEvent[]): ThreadTreeNode[] => {
    const hashTable: { [key: string]: ThreadTreeNode } = Object.create(null)
    replies.forEach(
      (reply) => (hashTable[reply.id] = { event: reply, child_nodes: [] })
    )
    const thread_tree: ThreadTreeNode[] = []
    replies.forEach((reply) => {
      let reply_parent_id = getParentId(reply)
      if (reply_parent_id && hashTable[reply_parent_id])
        hashTable[reply_parent_id].child_nodes.push(hashTable[reply.id])
      else thread_tree.push(hashTable[reply.id])
    })
    return thread_tree
  }

  let thread_tree_store = writable(createThreadTree(replies ? replies : []))
  $: {
    if (replies) thread_tree_store.set(createThreadTree(replies))
  }
</script>

<EventCard {type} {event} />

<ThreadWrapper num_replies={$thread_tree_store.length}>
  {#each $thread_tree_store as tree}
    <ThreadTree {type} {tree} />
  {/each}
  <ComposeReply {type} reply_to_event_id={event.id} />
</ThreadWrapper>
