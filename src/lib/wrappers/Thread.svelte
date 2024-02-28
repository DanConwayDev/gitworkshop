<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk'
  import { writable } from 'svelte/store'
  import type { ThreadTreeNode } from '$lib/components/events/type'
  import ThreadTree from './ThreadTree.svelte'

  export let event: NDKEvent
  export let type: 'proposal' | 'issue' = 'proposal'
  export let show_compose = true

  export let replies: NDKEvent[] | undefined = undefined

  const getParentId = (reply: NDKEvent): string | undefined => {
    let t =
      reply.tags.find((tag) => tag.length === 4 && tag[3] === 'reply') ||
      reply.tags.find((tag) => tag.length === 4 && tag[3] === 'root') ||
      // include events that don't use nip 10 markers
      reply.tags.find((tag) => tag.length < 4 && tag[0] === 'e')
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
      if (reply_parent_id && hashTable[reply_parent_id]) {
        hashTable[reply_parent_id].child_nodes.push(hashTable[reply.id])
        hashTable[reply_parent_id].child_nodes.sort(
          (a, b) => (a.event.created_at || 0) - (b.event.created_at || 0)
        )
      } else thread_tree.push(hashTable[reply.id])
    })
    return thread_tree
  }

  const splitIntoRevisionThreadTrees = (
    tree: ThreadTreeNode
  ): ThreadTreeNode[] => {
    let thread_revision_trees: ThreadTreeNode[] = [
      {
        ...tree,
        child_nodes: [...tree?.child_nodes],
      },
    ]
    thread_revision_trees[0].child_nodes =
      thread_revision_trees[0].child_nodes.filter((n) => {
        if (
          n.event.tags.some((t) => t.length > 1 && t[1] === 'revision-root')
        ) {
          thread_revision_trees.push(n)
          return false
        }
        return true
      })
    return thread_revision_trees.sort(
      (a, b) => (a.event.created_at || 0) - (b.event.created_at || 0)
    )
  }

  let thread_tree_store = writable(
    createThreadTree(replies ? [event, ...replies] : [event])
  )
  let thread_tree_root: ThreadTreeNode | undefined
  let thread_revision_trees: ThreadTreeNode[] | undefined
  // TODO: add 'mentions' and secondary references that fall outside of root childNodes
  //       they should appear in the UI as 'mentioned in' and be clear that replies ar enot incldued
  $: {
    if (replies) thread_tree_store.set(createThreadTree([event, ...replies]))
    thread_tree_root = $thread_tree_store.find((t) => t.event.id === event.id)
    if (type === 'proposal' && thread_tree_root)
      thread_revision_trees = splitIntoRevisionThreadTrees(thread_tree_root)
  }
</script>

{#if type === 'issue' && thread_tree_root}
  <ThreadTree {type} tree={thread_tree_root} {show_compose} />
{/if}
{#if thread_revision_trees}
  {#each thread_revision_trees as tree, i}
    {#if i > 0}
      <div class="divider">new revision</div>
    {/if}
    <ThreadTree
      {type}
      {tree}
      show_compose={show_compose && thread_revision_trees.length - 1 === i}
    />
  {/each}
{/if}
