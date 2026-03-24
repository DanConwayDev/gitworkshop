/**
 * Thread tree builder — pure data structure, no UI.
 *
 * Converts a flat list of NostrEvents into a tree based on reply
 * relationships (NIP-10 `e` tag markers and NIP-22 `E`/`e` tags).
 *
 * Adapted from gitworkshop.dev's thread_tree.ts with the same semantics
 * so threads display identically. The data structure is intentionally
 * decoupled from rendering so the UI can change independently.
 */
import type { NostrEvent } from "nostr-tools";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreadTreeNode {
  event: NostrEvent;
  children: ThreadTreeNode[];
  /** True when the direct parent event was not found in the input set. */
  missingParent?: boolean;
  /** True when this node appears as a mention (`q` tag) rather than a reply. */
  mention?: boolean;
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

/**
 * Extract the root event ID from NIP-22 uppercase `E` tag or NIP-10
 * `e` tag with `root` marker.
 */
function getRootId(event: NostrEvent): string | undefined {
  const rootTag =
    event.tags.find((t) => t.length > 1 && t[0] === "E") ||
    event.tags.find((t) => t.length === 4 && t[0] === "e" && t[3] === "root");
  return rootTag?.[1];
}

/**
 * Extract the direct parent event ID from reply tags.
 *
 * Priority:
 * 1. NIP-10 `e` tag with `reply` marker
 * 2. NIP-10 `e` tag with `root` marker (when no `reply` marker exists)
 * 3. Unmarked `e` tag (pre-NIP-10 convention), excluding `mention` markers
 * 4. NIP-22 uppercase `E` tag (root of thread — used as parent fallback)
 */
export function getParentId(event: NostrEvent): string | undefined {
  const tag =
    event.tags.find(
      (t) => t.length === 4 && t[0] === "e" && t[3] === "reply",
    ) ||
    event.tags.find((t) => t.length === 4 && t[0] === "e" && t[3] === "root") ||
    // Include events that don't use NIP-10 markers
    event.tags.find(
      (t) => t[0] === "e" && !(t.length === 4 && t[3] === "mention"),
    ) ||
    event.tags.find((t) => t.length > 1 && t[0] === "E");
  return tag?.[1];
}

/**
 * Extract event IDs referenced as mentions (`e` tag with `mention` marker
 * or `q` tag).
 */
function getMentionIds(event: NostrEvent): string[] {
  return event.tags
    .filter(
      (t) =>
        (t.length === 4 && t[0] === "e" && t[3] === "mention") ||
        (t.length > 1 && t[0] === "q"),
    )
    .map((t) => t[1]);
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

/**
 * Build a tree from a flat array of events.
 *
 * Events whose parent is present in the set become children of that parent.
 * Events whose parent is missing but whose root is present fall back to the
 * root (with `missingParent` flag). Events referenced only via `q`/mention
 * tags are attached with the `mention` flag.
 *
 * Top-level nodes (no parent found at all) are returned as the root array.
 * Children at each level are sorted by `created_at` ascending.
 */
export function buildThreadTree(events: NostrEvent[]): ThreadTreeNode[] {
  const table: Record<string, ThreadTreeNode> = Object.create(null);

  for (const ev of events) {
    table[ev.id] = { event: ev, children: [] };
  }

  const roots: ThreadTreeNode[] = [];

  const addToParent = (parentId: string, childId: string) => {
    table[parentId].children.push(table[childId]);
    table[parentId].children.sort(
      (a, b) => (a.event.created_at ?? 0) - (b.event.created_at ?? 0),
    );
  };

  for (const ev of events) {
    const parentId = getParentId(ev);

    if (parentId && table[parentId]) {
      addToParent(parentId, ev.id);
      continue;
    }

    // Parent not in set — try root fallback or mention attachment
    const rootId = getRootId(ev);
    const mentionedInThread = new Set(
      getMentionIds(ev).filter((id) => !!table[id]),
    );

    if (parentId && mentionedInThread.size === 0) {
      // We're missing the parent event (deleted or not fetched)
      table[ev.id].missingParent = true;
    }

    if (rootId && table[rootId]) {
      addToParent(rootId, ev.id);
    } else if (mentionedInThread.size > 0) {
      table[ev.id].mention = true;
      for (const mentionParent of mentionedInThread) {
        addToParent(mentionParent, ev.id);
      }
    } else {
      roots.push(table[ev.id]);
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// High-level helper
// ---------------------------------------------------------------------------

/**
 * Build the thread tree for a specific root event (e.g. an issue or PR)
 * and its replies.
 *
 * Returns the tree rooted at `rootEvent`. Orphan replies that can't be
 * attached anywhere are silently dropped (they'd appear as separate roots
 * in `buildThreadTree` but aren't relevant to this thread).
 */
export function getThreadTree(
  rootEvent: NostrEvent,
  replies: NostrEvent[],
): ThreadTreeNode | undefined {
  const allTrees = buildThreadTree([rootEvent, ...replies]);
  const tree = allTrees.find((t) => t.event.id === rootEvent.id);
  if (tree) {
    delete tree.missingParent; // root of the tree isn't missing a parent
  }
  return tree;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Recursively count all descendants of a node. */
export function countDescendants(node: ThreadTreeNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + countDescendants(child),
    0,
  );
}

/** Flatten a tree into a depth-first ordered array of events. */
export function flattenTree(node: ThreadTreeNode): NostrEvent[] {
  const result: NostrEvent[] = [node.event];
  for (const child of node.children) {
    result.push(...flattenTree(child));
  }
  return result;
}
