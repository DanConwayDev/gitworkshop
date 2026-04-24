/**
 * remarkCommitLinks — remark plugin that detects bare git commit-like hex
 * strings in text nodes and converts them into link nodes with a special
 * `commit:` scheme.
 *
 * The `a` component override in CommentContent / MarkdownContent then checks
 * whether the hash is actually present in the local git pool cache and, if so,
 * renders a React Router `<Link>` to `${basePath}/commit/${hash}`. If the hash
 * is not in the cache the link falls through to plain monospace text — no
 * network requests are triggered just to resolve a mention.
 *
 * Pattern matched: 7–40 consecutive lowercase hex characters that are NOT
 * already part of a longer hex run (word-boundary anchored). This covers both
 * short abbreviated hashes (e.g. `abc1234`) and full 40-char SHA-1 hashes.
 *
 * Exclusions:
 *   - Hex strings inside code spans / code blocks (already handled by remark
 *     — text nodes inside `inlineCode` / `code` are not visited).
 *   - Strings that are already inside a link node (to avoid double-wrapping).
 */

// Minimal mdast node types — defined inline to avoid a direct `mdast` dep.
interface MdastNode {
  type: string;
}
interface MdastParent extends MdastNode {
  children: MdastNode[];
}
interface MdastText extends MdastNode {
  type: "text";
  value: string;
}
interface MdastLink extends MdastParent {
  type: "link";
  url: string;
  children: MdastNode[];
}
interface MdastRoot extends MdastParent {
  type: "root";
}

/**
 * Matches a bare hex string of 7–40 chars that looks like a git commit hash.
 * The negative look-ahead/behind ensures we don't match substrings of longer
 * hex runs (e.g. a 64-char Nostr pubkey).
 *
 * We use a capturing group so split() gives us the matched segments too.
 */
const COMMIT_HASH_RE = /(?<![0-9a-f])([0-9a-f]{7,40})(?![0-9a-f])/g;

function isInsideLink(ancestors: MdastNode[]): boolean {
  return ancestors.some((n) => n.type === "link");
}

function splitTextNode(text: MdastText): Array<MdastText | MdastLink> | null {
  const parts: Array<MdastText | MdastLink> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  COMMIT_HASH_RE.lastIndex = 0;

  while ((match = COMMIT_HASH_RE.exec(text.value)) !== null) {
    const hash = match[1];
    const start = match.index;
    const end = start + hash.length;

    if (start > lastIndex) {
      parts.push({ type: "text", value: text.value.slice(lastIndex, start) });
    }

    const linkNode: MdastLink = {
      type: "link",
      url: `commit:${hash}`,
      children: [{ type: "text", value: hash } as MdastText],
    };
    parts.push(linkNode);
    lastIndex = end;
  }

  if (parts.length === 0) return null; // no matches — leave node unchanged

  if (lastIndex < text.value.length) {
    parts.push({ type: "text", value: text.value.slice(lastIndex) });
  }

  return parts;
}

function walkParent(node: MdastParent, ancestors: MdastNode[]) {
  // Don't descend into code blocks or inline code
  if (node.type === "code" || node.type === "inlineCode") return;

  const newChildren: MdastNode[] = [];
  let changed = false;

  for (const child of node.children) {
    if (child.type === "text" && !isInsideLink(ancestors)) {
      const replacement = splitTextNode(child as MdastText);
      if (replacement) {
        newChildren.push(...replacement);
        changed = true;
        continue;
      }
    }

    if ("children" in child) {
      walkParent(child as MdastParent, [...ancestors, node]);
    }

    newChildren.push(child);
  }

  if (changed) {
    node.children = newChildren;
  }
}

/**
 * Remark plugin that converts bare git commit hash strings in text nodes into
 * link nodes with `href="commit:<hash>"`.
 */
export function remarkCommitLinks() {
  return (tree: MdastRoot) => {
    walkParent(tree, []);
  };
}
