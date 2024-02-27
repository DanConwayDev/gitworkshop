import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { User } from '../users/type'

export interface Event {
  author: User
  content: unknown
}

export interface ThreadTreeNode {
  event: NDKEvent
  child_nodes: ThreadTreeNode[]
}
