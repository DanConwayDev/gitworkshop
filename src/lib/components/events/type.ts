import type { Event } from 'nostr-tools'
import type { PubKeyString } from '$lib/dbs/types'

export interface TreeEvent {
  author: PubKeyString
  content: unknown
}

export interface ThreadTreeNode {
  event: Event
  child_nodes: ThreadTreeNode[]
}
