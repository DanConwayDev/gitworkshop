import { describe, expect, test } from 'vitest'
import { createThreadTree, getParentId, getThreadTrees } from './thread_tree'
import NDK, {
  NDKEvent,
  NDKPrivateKeySigner,
  type NDKTag,
} from '@nostr-dev-kit/ndk'
import { reply_kind } from '$lib/kinds'

const ndk = new NDK()
ndk.signer = new NDKPrivateKeySigner(
  '08608a436aee4c07ea5c36f85cb17c58f52b3ad7094f9318cc777771f0bf218b'
)
const generateEventWithTags = async (tags: NDKTag[]): Promise<NDKEvent> => {
  const event = new NDKEvent(ndk)
  event.kind = reply_kind
  event.content = Math.random().toFixed(10)
  tags.forEach((tag) => {
    event.tags.push(tag)
  })
  await event.sign()
  return event
}

describe('getParentId', () => {
  describe('when all types of e tag are present', () => {
    test('returns id of e reply tag', async () => {
      expect(
        getParentId(
          await generateEventWithTags([
            ['e', '012'],
            ['e', '123', '', 'root'],
            ['e', '789', '', 'mention'],
            ['e', '456', '', 'reply'],
          ])
        )
      ).toEqual('456')
    })
  })
  describe('when all types of e tag are present except reply', () => {
    test('returns id of e root tag', async () => {
      expect(
        getParentId(
          await generateEventWithTags([
            ['e', '012'],
            ['e', '123', '', 'root'],
            ['e', '789', '', 'mention'],
          ])
        )
      ).toEqual('123')
    })
  })
  describe('when only mention and unmarked e tags are present', () => {
    test('returns id of unmarked e tag', async () => {
      expect(
        getParentId(
          await generateEventWithTags([
            ['e', '012'],
            ['e', '789', '', 'mention'],
          ])
        )
      ).toEqual('012')
    })
  })
  describe('when only mention e tag are present', () => {
    test('return undefined', async () => {
      expect(
        getParentId(await generateEventWithTags([['e', '789', '', 'mention']]))
      ).toBeUndefined()
    })
  })
})

describe('createThreadTree', () => {
  describe('only events without parents are returned as top level array items', () => {
    describe('1 parent, 1 child', () => {
      test('returns array with only parent at top level', async () => {
        const root = await generateEventWithTags([])
        const reply_to_root = await generateEventWithTags([
          ['e', root.id, '', 'reply'],
        ])
        const tree = createThreadTree([root, reply_to_root])
        expect(tree).to.have.length(1)
        expect(tree[0].event.id).to.eq(root.id)
      })
      test('parent has child in child_nodes, child has empty child nodes', async () => {
        const root = await generateEventWithTags([])
        const reply_to_root = await generateEventWithTags([
          ['e', root.id, '', 'reply'],
        ])
        const tree = createThreadTree([root, reply_to_root])
        expect(tree[0].child_nodes).to.have.length(1)
        expect(tree[0].child_nodes[0].event.id).to.eq(reply_to_root.id)
        expect(tree[0].child_nodes[0].child_nodes).to.be.length(0)
      })
    })
    describe('1 grand parent, 1 parent, 1 child - out of order', () => {
      test('returns array with only grand parent at top level with parent as its child, and child as parents child', async () => {
        const grand_parent = await generateEventWithTags([])
        const parent = await generateEventWithTags([
          ['e', grand_parent.id, '', 'reply'],
        ])
        const child = await generateEventWithTags([
          ['e', parent.id, '', 'reply'],
        ])
        const tree = createThreadTree([grand_parent, child, parent])
        expect(tree).to.have.length(1)
        expect(tree[0].event.id).to.eq(grand_parent.id)
        expect(tree[0].child_nodes).to.have.length(1)
        expect(tree[0].child_nodes[0].event.id).to.eq(parent.id)
        expect(tree[0].child_nodes[0].child_nodes).to.have.length(1)
        expect(tree[0].child_nodes[0].child_nodes[0].event.id).to.eq(child.id)
        expect(
          tree[0].child_nodes[0].child_nodes[0].child_nodes
        ).to.have.length(0)
      })
    })
    describe('2 roots, 1 child', () => {
      test('returns array with 2 roots at top level', async () => {
        const root = await generateEventWithTags([])
        const root2 = await generateEventWithTags([])
        const reply_to_root = await generateEventWithTags([
          ['e', root.id, '', 'reply'],
        ])
        const tree = createThreadTree([root, reply_to_root, root2])
        expect(tree).to.have.length(2)
        expect(tree[0].event.id).to.eq(root.id)
        expect(tree[1].event.id).to.eq(root2.id)
        expect(tree[1].child_nodes).to.have.length(0)
        expect(tree[0].child_nodes).to.have.length(1)
        expect(tree[0].child_nodes[0].event.id).to.eq(reply_to_root.id)
        expect(tree[0].child_nodes[0].child_nodes).to.be.length(0)
      })
    })
  })
})

describe('getThreadTrees', () => {
  describe('issue', () => {
    describe('2 roots, 1 child', () => {
      test('array only contains node related to specified event and children', async () => {
        const root = await generateEventWithTags([])
        const root2 = await generateEventWithTags([])
        const reply_to_root = await generateEventWithTags([
          ['e', root.id, '', 'reply'],
        ])
        const trees = getThreadTrees('issue', root, [
          root,
          reply_to_root,
          root2,
        ])
        expect(trees).to.have.length(1)
        expect(trees[0].event.id).to.eq(root.id)
        expect(trees[0].child_nodes).to.have.length(1)
        expect(trees[0].child_nodes[0].event.id).to.eq(reply_to_root.id)
        expect(trees[0].child_nodes[0].child_nodes).to.be.length(0)
      })
    })
  })
  describe('proposal', () => {
    describe('2 roots, 1 child', () => {
      test('array only contains node related to specified event and children', async () => {
        const root = await generateEventWithTags([])
        const root2 = await generateEventWithTags([])
        const reply_to_root = await generateEventWithTags([
          ['e', root.id, '', 'reply'],
        ])
        const trees = getThreadTrees('proposal', root, [
          root,
          reply_to_root,
          root2,
        ])
        expect(trees).to.have.length(1)
        expect(trees[0].event.id).to.eq(root.id)
        expect(trees[0].child_nodes).to.have.length(1)
        expect(trees[0].child_nodes[0].event.id).to.eq(reply_to_root.id)
        expect(trees[0].child_nodes[0].child_nodes).to.be.length(0)
      })
    })
    describe('2 roots, 1 reply, 1 revision', () => {
      test('array contains node related to specified event with reply, and revision', async () => {
        const root = await generateEventWithTags([])
        const root2 = await generateEventWithTags([])
        const reply_to_root = await generateEventWithTags([
          ['e', root.id, '', 'reply'],
        ])
        const revision_of_root = await generateEventWithTags([
          ['e', root.id, '', 'reply'],
          ['t', 'revision-root'],
        ])
        const trees = getThreadTrees('proposal', root, [
          root,
          reply_to_root,
          root2,
          revision_of_root,
        ])
        expect(trees).to.have.length(2)
        expect(trees[0].event.id).to.eq(root.id)
        expect(trees[0].child_nodes).to.have.length(1)
        expect(trees[0].child_nodes[0].event.id).to.eq(reply_to_root.id)
        expect(trees[1].event.id).to.eq(revision_of_root.id)
      })
    })
  })
  describe('issue', () => {
    describe('2 roots, 1 reply, 1 revision', () => {
      test('array contains only node related to specified event with reply and revision as children', async () => {
        const root = await generateEventWithTags([])
        const root2 = await generateEventWithTags([])
        const reply_to_root = await generateEventWithTags([
          ['e', root.id, '', 'reply'],
        ])
        const revision_of_root = await generateEventWithTags([
          ['e', root.id, '', 'reply'],
          ['t', 'revision-root'],
        ])
        const trees = getThreadTrees('issue', root, [
          root,
          reply_to_root,
          root2,
          revision_of_root,
        ])
        expect(trees).to.have.length(1)
        expect(trees[0].event.id).to.eq(root.id)
        expect(trees[0].child_nodes).to.have.length(2)
        expect(trees[0].child_nodes[0].event.id).to.eq(reply_to_root.id)
        expect(trees[0].child_nodes[1].event.id).to.eq(revision_of_root.id)
      })
    })
  })
})
