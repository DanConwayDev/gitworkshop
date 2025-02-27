import type { NostrEvent } from 'nostr-tools';
import type { EventIdString, ThreadTreeNode } from './types';

function getRootId(event: NostrEvent): string | undefined {
	const root_tag =
		event.tags.find((t) => t.length > 1 && t[0] === 'E') ||
		event.tags.find((t) => t.length === 4 && t[0] === 'e' && t[3] === 'root');
	if (root_tag) return root_tag[1];
	return undefined;
}

export const getParentId = (reply: NostrEvent): EventIdString | undefined => {
	const t =
		reply.tags.find((tag) => tag.length === 4 && tag[3] === 'reply') ||
		reply.tags.find((tag) => tag.length === 4 && tag[3] === 'root') ||
		// include events that don't use nip 10 markers
		reply.tags.find((tag) => tag[0] === 'e' && !(tag.length === 4 && tag[3] === 'mention')) ||
		reply.tags.find((tag) => tag.length > 1 && tag[0] === 'E');
	return t ? t[1] : undefined;
};

const getMentions = (reply: NostrEvent): EventIdString[] => {
	return reply.tags
		.filter(
			(tag) => (tag.length === 4 && tag[3] === 'mention') || (tag.length > 1 && tag[0] === 'q')
		)
		.map((t) => t[1]);
};

export const createThreadTree = (replies: NostrEvent[]): ThreadTreeNode[] => {
	const hashTable: { [key: EventIdString]: ThreadTreeNode } = Object.create(null);
	replies.forEach((reply) => (hashTable[reply.id] = { event: reply, child_nodes: [] }));
	const thread_tree: ThreadTreeNode[] = [];
	replies.forEach((reply) => {
		const addToParent = (reply_parent_id: EventIdString) => {
			hashTable[reply_parent_id].child_nodes.push(hashTable[reply.id]);
			hashTable[reply_parent_id].child_nodes.sort(
				(a, b) => (a.event.created_at || 0) - (b.event.created_at || 0)
			);
		};
		const reply_parent_id = getParentId(reply);
		if (reply_parent_id && hashTable[reply_parent_id]) {
			addToParent(reply_parent_id);
		} else {
			const reply_root_id = getRootId(reply);
			const mentioned_in_thread = new Set(getMentions(reply).filter((id) => !!hashTable[id]));
			if (reply_parent_id && mentioned_in_thread.size === 0) {
				// we must be missing the parent event. could be deleted or not found
				hashTable[reply.id].missing_parent = true;
			}
			if (reply_root_id && hashTable[reply_root_id]) {
				addToParent(reply_root_id);
			} else if (mentioned_in_thread.size > 0) {
				// looping seems dangerous as the event may appear multiple times. lets make sure its a lite wrapper.
				hashTable[reply.id].mention = true;
				mentioned_in_thread.forEach((parent) => {
					addToParent(parent);
				});
			} else {
				thread_tree.push(hashTable[reply.id]);
			}
		}
	});
	return thread_tree;
};

export const splitIntoRevisionThreadTrees = (tree: ThreadTreeNode): ThreadTreeNode[] => {
	const thread_revision_trees: ThreadTreeNode[] = [
		{
			...tree,
			child_nodes: [...(tree?.child_nodes ?? [])]
		}
	];
	thread_revision_trees[0].child_nodes = [
		...thread_revision_trees[0].child_nodes.filter((n) => {
			if (n.event.tags.some((t) => t.length > 1 && t[1] === 'revision-root')) {
				thread_revision_trees.push(n);
				return false;
			}
			return true;
		})
	];
	return thread_revision_trees.sort(
		(a, b) => (a.event.created_at || 0) - (b.event.created_at || 0)
	);
};

export const getThreadTrees = (
	type: 'pr' | 'issue',
	event: NostrEvent | undefined,
	replies: NostrEvent[] | undefined
): ThreadTreeNode[] => {
	if (event) {
		const all_trees = createThreadTree(replies ? [event, ...replies] : [event]);
		const event_tree = all_trees.find((t) => t.event.id === event.id);
		delete event_tree?.missing_parent; // the top of the tree isn't missing a parent

		if (event_tree) {
			// return all_trees;
			if (type === 'pr') return splitIntoRevisionThreadTrees(event_tree);
			return [event_tree];
		}
	}

	return [];
};
