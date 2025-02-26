import type { NostrEvent } from 'nostr-tools';

export interface ThreadTreeNode {
	event: NostrEvent;
	child_nodes: ThreadTreeNode[];
	missing_parent?: boolean;
	mention?: boolean;
}
