/**
 * Utility functions for the NostrComposer component.
 * Kept in a separate file so they can be imported without triggering
 * the react-refresh/only-export-components lint rule.
 */

// Matches nostr:npub1..., nostr:nprofile1..., nostr:note1..., etc.
const NOSTR_EMBED_RE =
  /nostr:(npub1|nprofile1|note1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+/g;

// Markdown syntax worth previewing: bold, italic, code, headings, links, lists, blockquotes
const MARKDOWN_RE = /(\*\*|__|\*|_|`|#{1,6} |\[.+\]\(|^[-*+] |^> )/m;

const NSEC_RE = /nsec1[023456789acdefghjklmnpqrstuvwxyz]+/;

/**
 * Returns true if the value contains markdown syntax or nostr: identifiers
 * that would render differently in preview mode.
 */
export function hasPreviewableContent(value: string): boolean {
  if (!value) return false;
  NOSTR_EMBED_RE.lastIndex = 0;
  return MARKDOWN_RE.test(value) || NOSTR_EMBED_RE.test(value);
}

/**
 * Returns true if the given composer value contains a bare nsec1 key.
 * Use this to disable the submit button in parent forms.
 */
export function composerHasNsec(value: string): boolean {
  return NSEC_RE.test(value);
}
