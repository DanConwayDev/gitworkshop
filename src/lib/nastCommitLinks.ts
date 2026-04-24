/**
 * nastCommitLinks — NAST transformer that detects bare git commit-like hex
 * strings in text nodes and converts them into link nodes with a special
 * `commit:` scheme.
 *
 * Mirrors the logic of remarkCommitLinks but operates on the applesauce NAST
 * tree (used by useRenderedContent) rather than the remark mdast tree.
 *
 * Pattern matched: 7–40 consecutive lowercase hex characters that are NOT
 * already part of a longer hex run (word-boundary anchored). This covers both
 * short abbreviated hashes (e.g. `abc1234`) and full 40-char SHA-1 hashes.
 *
 * The `link` component in the ComponentMap then checks whether the hash is
 * actually present in the local git pool cache and, if so, renders a
 * React Router <Link>. If not, it falls back to plain monospace text.
 */

import { findAndReplace } from "applesauce-content/nast";
import type { Root } from "applesauce-content/nast";

/**
 * Matches a bare hex string of 7–40 chars that looks like a git commit hash.
 * Negative look-ahead/behind prevents matching substrings of longer hex runs
 * (e.g. a 64-char Nostr pubkey or event ID).
 *
 * Must use the `g` flag so findAndReplace can iterate all matches.
 */
const COMMIT_HASH_RE = /(?<![0-9a-f])([0-9a-f]{7,40})(?![0-9a-f])/g;

/**
 * NAST transformer that converts bare git commit hash strings in text nodes
 * into link nodes with `href="commit:<hash>"`.
 *
 * Usage:
 *   useRenderedContent(event, components, {
 *     transformers: [...textNoteTransformers, commitHashLinks],
 *   })
 */
export function commitHashLinks(): (tree: Root) => void {
  return (tree) => {
    findAndReplace(tree, [
      [
        COMMIT_HASH_RE,
        (_match: string, hash: string) => ({
          type: "link",
          href: `commit:${hash}`,
          value: hash,
        }),
      ],
    ]);
  };
}
