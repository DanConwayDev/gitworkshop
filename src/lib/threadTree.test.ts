import { describe, expect, test } from "vitest";
import {
  buildThreadTree,
  getParentId,
  getThreadTree,
  countDescendants,
  flattenTree,
} from "./threadTree";
import type { NostrEvent } from "nostr-tools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const randomHex = (): string =>
  [...Array(64)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");

let createdAtCounter = 0;

function makeEvent(tags: string[][] = [], kind: number = 1): NostrEvent {
  createdAtCounter += 1;
  return {
    kind,
    content: Math.random().toFixed(10),
    created_at: createdAtCounter,
    tags,
    pubkey: randomHex(),
    id: randomHex(),
    sig: randomHex(),
  };
}

// ---------------------------------------------------------------------------
// getParentId
// ---------------------------------------------------------------------------

describe("getParentId", () => {
  test("prefers e reply marker over root and unmarked", () => {
    expect(
      getParentId(
        makeEvent([
          ["e", "012"],
          ["e", "123", "", "root"],
          ["e", "789", "", "mention"],
          ["e", "456", "", "reply"],
        ]),
      ),
    ).toBe("456");
  });

  test("falls back to e root marker when no reply marker", () => {
    expect(
      getParentId(
        makeEvent([
          ["e", "012"],
          ["e", "123", "", "root"],
          ["e", "789", "", "mention"],
        ]),
      ),
    ).toBe("123");
  });

  test("falls back to unmarked e tag when only mention markers exist", () => {
    expect(
      getParentId(
        makeEvent([
          ["e", "012"],
          ["e", "789", "", "mention"],
        ]),
      ),
    ).toBe("012");
  });

  test("returns undefined when only mention e tags exist", () => {
    expect(
      getParentId(makeEvent([["e", "789", "", "mention"]])),
    ).toBeUndefined();
  });

  test("returns NIP-22 E tag value", () => {
    expect(getParentId(makeEvent([["E", "789"]], 1111))).toBe("789");
  });
});

// ---------------------------------------------------------------------------
// buildThreadTree
// ---------------------------------------------------------------------------

describe("buildThreadTree", () => {
  test("1 parent, 1 child — only parent at top level", () => {
    const root = makeEvent();
    const reply = makeEvent([["e", root.id, "", "reply"]]);
    const tree = buildThreadTree([root, reply]);

    expect(tree).toHaveLength(1);
    expect(tree[0].event.id).toBe(root.id);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].event.id).toBe(reply.id);
    expect(tree[0].children[0].children).toHaveLength(0);
  });

  test("grandparent > parent > child — out of order input", () => {
    const grandparent = makeEvent();
    const parent = makeEvent([["e", grandparent.id, "", "reply"]]);
    const child = makeEvent([["e", parent.id, "", "reply"]]);

    const tree = buildThreadTree([grandparent, child, parent]);

    expect(tree).toHaveLength(1);
    expect(tree[0].event.id).toBe(grandparent.id);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].event.id).toBe(parent.id);
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].event.id).toBe(child.id);
  });

  test("NIP-22 E/e tags — nested replies", () => {
    const grandparent = makeEvent();
    const parent = makeEvent(
      [
        ["E", grandparent.id],
        ["e", grandparent.id],
      ],
      1111,
    );
    const child = makeEvent(
      [
        ["E", grandparent.id],
        ["e", parent.id],
      ],
      1111,
    );

    const tree = buildThreadTree([grandparent, child, parent]);

    expect(tree).toHaveLength(1);
    expect(tree[0].event.id).toBe(grandparent.id);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].event.id).toBe(parent.id);
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].event.id).toBe(child.id);
  });

  test("NIP-22 — missing parent falls back to root E tag", () => {
    const grandparent = makeEvent();
    const missingParent = makeEvent(); // not included in tree input
    const child = makeEvent(
      [
        ["E", grandparent.id],
        ["e", missingParent.id],
      ],
      1111,
    );

    const tree = buildThreadTree([grandparent, child]);

    expect(tree).toHaveLength(1);
    expect(tree[0].event.id).toBe(grandparent.id);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].event.id).toBe(child.id);
    expect(tree[0].children[0].missingParent).toBe(true);
  });

  test("2 roots, 1 child — both roots at top level", () => {
    const root1 = makeEvent();
    const root2 = makeEvent();
    const reply = makeEvent([["e", root1.id, "", "reply"]]);

    const tree = buildThreadTree([root1, reply, root2]);

    expect(tree).toHaveLength(2);
    expect(tree[0].event.id).toBe(root1.id);
    expect(tree[1].event.id).toBe(root2.id);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[1].children).toHaveLength(0);
  });

  test("children are sorted by created_at ascending", () => {
    const root = makeEvent();
    // Create replies with explicit timestamps out of order
    const replyLate = makeEvent([["e", root.id, "", "reply"]]);
    replyLate.created_at = 300;
    const replyEarly = makeEvent([["e", root.id, "", "reply"]]);
    replyEarly.created_at = 100;
    const replyMid = makeEvent([["e", root.id, "", "reply"]]);
    replyMid.created_at = 200;

    const tree = buildThreadTree([root, replyLate, replyEarly, replyMid]);

    expect(tree[0].children.map((n) => n.event.created_at)).toEqual([
      100, 200, 300,
    ]);
  });

  test("q tag mentions are attached with mention flag", () => {
    const root = makeEvent();
    const mentioner = makeEvent([["q", root.id]]);

    const tree = buildThreadTree([root, mentioner]);

    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].mention).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getThreadTree
// ---------------------------------------------------------------------------

describe("getThreadTree", () => {
  test("returns tree rooted at the specified event", () => {
    const root = makeEvent();
    const orphan = makeEvent();
    const reply = makeEvent([["e", root.id, "", "reply"]]);

    const tree = getThreadTree(root, [reply, orphan]);

    expect(tree).toBeDefined();
    expect(tree!.event.id).toBe(root.id);
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0].event.id).toBe(reply.id);
    // orphan is not attached
  });

  test("root node does not have missingParent flag", () => {
    const root = makeEvent([["e", "nonexistent", "", "reply"]]);
    const tree = getThreadTree(root, []);
    expect(tree).toBeDefined();
    expect(tree!.missingParent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

describe("countDescendants", () => {
  test("counts all nested descendants", () => {
    const root = makeEvent();
    const child1 = makeEvent([["e", root.id, "", "reply"]]);
    const child2 = makeEvent([["e", root.id, "", "reply"]]);
    const grandchild = makeEvent([["e", child1.id, "", "reply"]]);

    const tree = buildThreadTree([root, child1, child2, grandchild]);
    expect(countDescendants(tree[0])).toBe(3);
  });
});

describe("flattenTree", () => {
  test("returns depth-first ordered events", () => {
    const root = makeEvent();
    const child = makeEvent([["e", root.id, "", "reply"]]);
    const grandchild = makeEvent([["e", child.id, "", "reply"]]);
    const child2 = makeEvent([["e", root.id, "", "reply"]]);

    const tree = buildThreadTree([root, child, grandchild, child2]);
    const flat = flattenTree(tree[0]);

    expect(flat.map((e) => e.id)).toEqual([
      root.id,
      child.id,
      grandchild.id,
      child2.id,
    ]);
  });
});
