/**
 * NIP-22 Comment blueprint (kind 1111).
 *
 * Creates a top-level comment on a NIP-34 issue or PR/patch event.
 *
 * NIP-22 tag conventions (no NIP-10 markers):
 *   - Uppercase E/K/P tags reference the thread root
 *   - Lowercase e/k/p tags reference the immediate reply parent
 *   - For a top-level comment the parent is the same event as the root
 *   - The 4th element of E/e tags is the event author's pubkey (not a marker)
 *   - K = root event kind (uppercase), k = parent event kind (lowercase)
 *
 * Usage:
 * ```ts
 * import { factory } from "@/services/actions";
 * import { publish } from "@/services/nostr";
 * import { CommentBlueprint } from "@/blueprints/comment";
 *
 * const template = await factory.create(
 *   CommentBlueprint,
 *   issueId,
 *   issuePubkey,
 *   ISSUE_KIND,
 *   "This looks like a bug in the parser.",
 *   relayHint,
 * );
 * const signed = await factory.sign(template);
 * await publish(signed);
 * ```
 */

import { blueprint } from "applesauce-core/event-factory";
import {
  setContent,
  includeAltTag,
  modifyPublicTags,
} from "applesauce-core/operations";
import { COMMENT_KIND } from "@/lib/nip34";
import type { NostrTag } from "@/lib/nostrContentTags";

export interface CommentOptions {
  /**
   * Extra tags derived from NIP-19 references in the comment body.
   * Use `extractContentTags(content)` to generate these.
   */
  contentTags?: NostrTag[];
  /**
   * When replying to an existing comment (kind 1111) rather than directly to
   * the root, provide the parent comment's details. The root E/K/P tags always
   * point to the original issue/PR; the lowercase e/k/p tags point to the
   * immediate parent (the comment being replied to).
   */
  parent?: {
    id: string;
    pubkey: string;
    /** Kind of the parent event — 1111 for a reply-to-comment */
    kind: number;
    relayHint?: string;
  };
}

/**
 * Blueprint for a NIP-22 comment (kind 1111) on a NIP-34 item or on an
 * existing comment.
 *
 * For a top-level comment (no `options.parent`):
 *   - Uppercase E/K/P point to the root issue/PR
 *   - Lowercase e/k/p also point to the root (parent === root)
 *
 * For a reply to a comment (`options.parent` provided):
 *   - Uppercase E/K/P still point to the root issue/PR
 *   - Lowercase e/k/p point to the parent comment (kind 1111)
 *
 * @param rootId      - Hex event ID of the root issue/PR
 * @param rootPubkey  - Hex pubkey of the root event author
 * @param rootKind    - Kind number of the root event (e.g. ISSUE_KIND, PR_KIND)
 * @param content     - Markdown body of the comment
 * @param relayHint   - Optional relay hint URL for the root event
 * @param options     - Optional: contentTags, parent
 */
export function CommentBlueprint(
  rootId: string,
  rootPubkey: string,
  rootKind: number,
  content: string,
  relayHint: string = "",
  options?: CommentOptions,
) {
  const contentTags = options?.contentTags ?? [];
  const rootKindStr = String(rootKind);

  // Parent defaults to the root when not replying to a comment
  const parent = options?.parent;
  const parentId = parent?.id ?? rootId;
  const parentPubkey = parent?.pubkey ?? rootPubkey;
  const parentKind = parent?.kind ?? rootKind;
  const parentRelayHint = parent?.relayHint ?? relayHint;

  return blueprint(
    COMMENT_KIND,
    setContent(content),
    includeAltTag("Comment"),
    modifyPublicTags((tags) => [
      ...tags,
      // Root scope: uppercase E with pubkey as 4th element (no marker)
      ["E", rootId, relayHint, rootPubkey],
      // Root kind (uppercase K)
      ["K", rootKindStr],
      // Root author (uppercase P)
      ["P", rootPubkey, relayHint],
      // Parent item: lowercase e pointing to the immediate parent
      ["e", parentId, parentRelayHint, parentPubkey],
      // Parent kind (lowercase k)
      ["k", String(parentKind)],
      // Parent author (lowercase p)
      ["p", parentPubkey],
      // q/p tags for any NIP-19 references in the comment body
      ...contentTags,
    ]),
  );
}
