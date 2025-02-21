import { describe, expect, test } from 'vitest';
import { createThreadTree, getParentId, getThreadTrees } from './thread_tree';
import type { NostrEvent } from 'nostr-tools';
import { ShortTextNote } from 'nostr-tools/kinds';
import { ReplyKind } from './kinds';

const randomHexID = (): string => {
	return [...Array(65)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
};
const generateEventWithTags = (tags: string[][] = [], kind: number = ShortTextNote): NostrEvent => {
	const event: NostrEvent = {
		kind,
		content: Math.random().toFixed(10),
		created_at: 0,
		tags,
		pubkey: randomHexID(),
		id: randomHexID(),
		sig: randomHexID()
	};
	return event;
};

describe('getParentId', () => {
	describe('when all types of e tag are present', () => {
		test('returns id of e reply tag', () => {
			expect(
				getParentId(
					generateEventWithTags([
						['e', '012'],
						['e', '123', '', 'root'],
						['e', '789', '', 'mention'],
						['e', '456', '', 'reply']
					])
				)
			).toEqual('456');
		});
	});
	describe('when all types of e tag are present except reply', () => {
		test('returns id of e root tag', () => {
			expect(
				getParentId(
					generateEventWithTags([
						['e', '012'],
						['e', '123', '', 'root'],
						['e', '789', '', 'mention']
					])
				)
			).toEqual('123');
		});
	});
	describe('when only mention and unmarked e tags are present', () => {
		test('returns id of unmarked e tag', () => {
			expect(
				getParentId(
					generateEventWithTags([
						['e', '012'],
						['e', '789', '', 'mention']
					])
				)
			).toEqual('012');
		});
	});
	describe('when only mention e tag are present', () => {
		test('return undefined', () => {
			expect(getParentId(generateEventWithTags([['e', '789', '', 'mention']]))).toBeUndefined();
		});
	});
	describe('when only nip22 E tag is present', () => {
		test('return undefined', () => {
			expect(getParentId(generateEventWithTags([['E', '789']], ReplyKind))).toEqual('789');
		});
	});
});

describe('createThreadTree', () => {
	describe('only events without parents are returned as top level array items', () => {
		describe('1 parent, 1 child', () => {
			test('returns array with only parent at top level', () => {
				const root = generateEventWithTags([]);
				const reply_to_root = generateEventWithTags([['e', root.id, '', 'reply']]);
				const tree = createThreadTree([root, reply_to_root]);
				expect(tree).to.have.length(1);
				expect(tree[0].event.id).to.eq(root.id);
			});
			test('parent has child in child_nodes, child has empty child nodes', () => {
				const root = generateEventWithTags([]);
				const reply_to_root = generateEventWithTags([['e', root.id, '', 'reply']]);
				const tree = createThreadTree([root, reply_to_root]);
				expect(tree[0].child_nodes).to.have.length(1);
				expect(tree[0].child_nodes[0].event.id).to.eq(reply_to_root.id);
				expect(tree[0].child_nodes[0].child_nodes).to.be.length(0);
			});
		});
		describe('1 grand parent, 1 parent, 1 child - out of order', () => {
			test('returns array with only grand parent at top level with parent as its child, and child as parents child', () => {
				const grand_parent = generateEventWithTags([]);
				const parent = generateEventWithTags([['e', grand_parent.id, '', 'reply']]);
				const child = generateEventWithTags([['e', parent.id, '', 'reply']]);
				const tree = createThreadTree([grand_parent, child, parent]);
				expect(tree).to.have.length(1);
				expect(tree[0].event.id).to.eq(grand_parent.id);
				expect(tree[0].child_nodes).to.have.length(1);
				expect(tree[0].child_nodes[0].event.id).to.eq(parent.id);
				expect(tree[0].child_nodes[0].child_nodes).to.have.length(1);
				expect(tree[0].child_nodes[0].child_nodes[0].event.id).to.eq(child.id);
				expect(tree[0].child_nodes[0].child_nodes[0].child_nodes).to.have.length(0);
			});
			describe('nip22 reply', () => {
				test('returns array with only grand parent at top level with parent as its child, and child as parents child', () => {
					const grand_parent = generateEventWithTags([]);
					const parent = generateEventWithTags(
						[
							['E', grand_parent.id],
							['e', grand_parent.id]
						],
						ReplyKind
					);
					const child = generateEventWithTags(
						[
							['E', grand_parent.id],
							['e', parent.id]
						],
						ReplyKind
					);
					const tree = createThreadTree([grand_parent, child, parent]);
					expect(tree).to.have.length(1);
					expect(tree[0].event.id).to.eq(grand_parent.id);
					expect(tree[0].child_nodes).to.have.length(1);
					expect(tree[0].child_nodes[0].event.id).to.eq(parent.id);
					expect(tree[0].child_nodes[0].child_nodes).to.have.length(1);
					expect(tree[0].child_nodes[0].child_nodes[0].event.id).to.eq(child.id);
					expect(tree[0].child_nodes[0].child_nodes[0].child_nodes).to.have.length(0);
				});
			});
		});
		describe('2 roots, 1 child', () => {
			test('returns array with 2 roots at top level', () => {
				const root = generateEventWithTags([]);
				const root2 = generateEventWithTags([]);
				const reply_to_root = generateEventWithTags([['e', root.id, '', 'reply']]);
				const tree = createThreadTree([root, reply_to_root, root2]);
				expect(tree).to.have.length(2);
				expect(tree[0].event.id).to.eq(root.id);
				expect(tree[1].event.id).to.eq(root2.id);
				expect(tree[1].child_nodes).to.have.length(0);
				expect(tree[0].child_nodes).to.have.length(1);
				expect(tree[0].child_nodes[0].event.id).to.eq(reply_to_root.id);
				expect(tree[0].child_nodes[0].child_nodes).to.be.length(0);
			});
		});
	});
});

describe('getThreadTrees', () => {
	describe('issue', () => {
		describe('2 roots, 1 child', () => {
			test('array only contains node related to specified event and children', () => {
				const root = generateEventWithTags([]);
				const root2 = generateEventWithTags([]);
				const reply_to_root = generateEventWithTags([['e', root.id, '', 'reply']]);
				const trees = getThreadTrees('issue', root, [root, reply_to_root, root2]);
				expect(trees).to.have.length(1);
				expect(trees[0].event.id).to.eq(root.id);
				expect(trees[0].child_nodes).to.have.length(1);
				expect(trees[0].child_nodes[0].event.id).to.eq(reply_to_root.id);
				expect(trees[0].child_nodes[0].child_nodes).to.be.length(0);
			});
		});
	});
	describe('pr', () => {
		describe('2 roots, 1 child', () => {
			test('array only contains node related to specified event and children', () => {
				const root = generateEventWithTags([]);
				const root2 = generateEventWithTags([]);
				const reply_to_root = generateEventWithTags([['e', root.id, '', 'reply']]);
				const trees = getThreadTrees('pr', root, [root, reply_to_root, root2]);
				expect(trees).to.have.length(1);
				expect(trees[0].event.id).to.eq(root.id);
				expect(trees[0].child_nodes).to.have.length(1);
				expect(trees[0].child_nodes[0].event.id).to.eq(reply_to_root.id);
				expect(trees[0].child_nodes[0].child_nodes).to.be.length(0);
			});
		});
		describe('2 roots, 1 reply, 1 revision', () => {
			test('array contains node related to specified event with reply, and revision', () => {
				const root = generateEventWithTags([]);
				const root2 = generateEventWithTags([]);
				const reply_to_root = generateEventWithTags([['e', root.id, '', 'reply']]);
				const revision_of_root = generateEventWithTags([
					['e', root.id, '', 'reply'],
					['t', 'revision-root']
				]);
				const trees = getThreadTrees('pr', root, [root, reply_to_root, root2, revision_of_root]);
				expect(trees).to.have.length(2);
				expect(trees[0].event.id).to.eq(root.id);
				expect(trees[0].child_nodes).to.have.length(1);
				expect(trees[0].child_nodes[0].event.id).to.eq(reply_to_root.id);
				expect(trees[1].event.id).to.eq(revision_of_root.id);
			});
		});
	});
	describe('issue', () => {
		describe('2 roots, 1 reply, 1 revision', () => {
			test('array contains only node related to specified event with reply and revision as children', () => {
				const root = generateEventWithTags([]);
				const root2 = generateEventWithTags([]);
				const reply_to_root = generateEventWithTags([['e', root.id, '', 'reply']]);
				const revision_of_root = generateEventWithTags([
					['e', root.id, '', 'reply'],
					['t', 'revision-root']
				]);
				const trees = getThreadTrees('issue', root, [root, reply_to_root, root2, revision_of_root]);
				expect(trees).to.have.length(1);
				expect(trees[0].event.id).to.eq(root.id);
				expect(trees[0].child_nodes).to.have.length(2);
				expect(trees[0].child_nodes[0].event.id).to.eq(reply_to_root.id);
				expect(trees[0].child_nodes[1].event.id).to.eq(revision_of_root.id);
			});
		});
	});
});
