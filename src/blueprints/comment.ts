/**
 * NIP-22 Comment blueprint (kind 1111).
 *
 * Delegates entirely to applesauce-common's CommentBlueprint which correctly
 * handles:
 *   - Top-level comments on any event kind (issues, PRs, patches)
 *   - Replies to existing comments (propagates root E/K/P tags automatically)
 *   - Addressable event parents (A tags for kind 30000-39999)
 *   - Relay hint resolution via ctx.getEventRelayHint
 *
 * Usage:
 * ```ts
 * import { factory } from "@/services/actions";
 * import { CommentBlueprint } from "@/blueprints/comment";
 *
 * // Top-level comment on an issue
 * const template = await factory.create(CommentBlueprint, issueEvent, "This looks like a bug.");
 *
 * // Reply to an existing comment
 * const template = await factory.create(CommentBlueprint, parentCommentEvent, "Agreed.");
 * ```
 */

export {
  CommentBlueprint,
  type CommentBlueprintOptions as CommentOptions,
} from "applesauce-common/blueprints";
