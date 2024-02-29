import type { ThreadTreeNode } from '$lib/components/events/type'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

export const getParentId = (reply: NDKEvent): string | undefined => {
  const t =
    reply.tags.find((tag) => tag.length === 4 && tag[3] === 'reply') ||
    reply.tags.find((tag) => tag.length === 4 && tag[3] === 'root') ||
    // include events that don't use nip 10 markers
    reply.tags.find((tag) => tag.length < 4 && tag[0] === 'e')
  return t ? t[1] : undefined
}

export const createThreadTree = (replies: NDKEvent[]): ThreadTreeNode[] => {
  const hashTable: { [key: string]: ThreadTreeNode } = Object.create(null)
  replies.forEach(
    (reply) => (hashTable[reply.id] = { event: reply, child_nodes: [] })
  )
  const thread_tree: ThreadTreeNode[] = []
  replies.forEach((reply) => {
    const reply_parent_id = getParentId(reply)
    if (reply_parent_id && hashTable[reply_parent_id]) {
      hashTable[reply_parent_id].child_nodes.push(hashTable[reply.id])
      hashTable[reply_parent_id].child_nodes.sort(
        (a, b) => (a.event.created_at || 0) - (b.event.created_at || 0)
      )
    } else thread_tree.push(hashTable[reply.id])
  })
  return thread_tree
}

export const splitIntoRevisionThreadTrees = (
  tree: ThreadTreeNode
): ThreadTreeNode[] => {
  const thread_revision_trees: ThreadTreeNode[] = [
    {
      ...tree,
      child_nodes: [...tree?.child_nodes],
    },
  ]
  thread_revision_trees[0].child_nodes = [
    ...thread_revision_trees[0].child_nodes.filter((n) => {
      if (n.event.tags.some((t) => t.length > 1 && t[1] === 'revision-root')) {
        thread_revision_trees.push(n)
        return false
      }
      return true
    }),
  ]
  return thread_revision_trees.sort(
    (a, b) => (a.event.created_at || 0) - (b.event.created_at || 0)
  )
}

export const getThreadTrees = (
  type: 'proposal' | 'issue',
  event: NDKEvent | undefined,
  replies: NDKEvent[] | undefined
): ThreadTreeNode[] => {
  if (event) {
    const all_trees = createThreadTree(replies ? [event, ...replies] : [event])
    const event_tree = all_trees.find((t) => t.event.id === event.id)
    if (event_tree) {
      // TODO: add 'mentions' and secondary references with a 'metioned event wrapper'
      if (type === 'proposal') return splitIntoRevisionThreadTrees(event_tree)
      return [event_tree]
    }
  }

  return []
}
