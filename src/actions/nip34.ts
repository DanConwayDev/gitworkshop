/**
 * NIP-34 Actions — CreateIssue, ChangeIssueStatus, RenameIssueSubject, CreateComment, DeleteEvent.
 *
 * Relay strategy — callers declare intent via group ID strings; the outbox
 * store resolves them to relay URLs via its relayGroupResolver:
 *
 *   - "outbox:<signerPubkey>"  → user's NIP-65 write relays
 *   - "30617:<pubkey>:<d>"     → repo's declared relays (one per coord)
 *   - "inbox:<notifyPubkey>"   → notification recipient's NIP-65 read relays
 *                                (resolved lazily; retried when kind:10002 arrives)
 *
 * Deletion requests (kind:5) mirror the relay groups of the original event:
 * outbox + repo relays + inbox of any p/P-tagged pubkeys on the deleted events.
 *
 * The git index (wss://index.ngit.dev) is intentionally NOT a publish target —
 * it syncs from other relays and should not receive direct publishes.
 */

import type { Action } from "applesauce-actions";
import type { NostrEvent } from "nostr-tools";
import { IssueBlueprint, type IssueOptions } from "@/blueprints/issue";
import { CommentBlueprint, type CommentOptions } from "@/blueprints/comment";
import {
  buildInlineCommentTemplate,
  type InlineCommentOptions,
} from "@/blueprints/inline-comment";
import {
  CoverNoteBlueprint,
  type CoverNoteOptions,
} from "@/blueprints/cover-note";
import { StatusChangeBlueprint, STATUS_KIND_MAP } from "@/blueprints/status";
import {
  IssueSubjectRenameBlueprint,
  IssueLabelBlueprint,
} from "@/blueprints/label";
import {
  DeletionBlueprint,
  AddressableDeletionBlueprint,
} from "@/blueprints/deletion";
import type { IssueStatus } from "@/lib/nip34";
import { outboxStore } from "@/services/outbox";
import { eventStore } from "@/services/nostr";

// ---------------------------------------------------------------------------
// Relay group ID helpers
// ---------------------------------------------------------------------------

/**
 * Build the group ID strings for a publish call.
 *
 * Always includes:
 *   - "outbox:<signerPubkey>" → user's NIP-65 write relays
 *   - "30617:<pubkey>:<d>"    → repo's declared relays (one per coord)
 *
 * Optionally includes notification inbox groups:
 *   - "inbox:<pubkey>" → recipient's NIP-65 read relays (resolved lazily)
 */
function buildGroupIds(
  signerPubkey: string,
  repoCoords?: string[],
  notifyPubkeys?: string[],
): string[] {
  const ids: string[] = [`outbox:${signerPubkey}`];
  for (const coord of repoCoords ?? []) ids.push(coord);
  for (const pubkey of notifyPubkeys ?? []) ids.push(`inbox:${pubkey}`);
  return ids;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Create a NIP-34 git issue (kind:1621).
 *
 * Publishes to: user outbox + repo relays + repo owner's inbox (deferred).
 */
export function CreateIssue(
  repoCoord: string,
  ownerPubkey: string,
  subject: string,
  content: string,
  options?: IssueOptions,
): Action {
  return async ({ factory, sign, self }) => {
    const draft = await factory.create(
      IssueBlueprint,
      repoCoord,
      ownerPubkey,
      subject,
      content,
      options,
    );
    const signed = await sign(draft);

    // Add to local store immediately so the UI reflects the new issue without
    // waiting for a relay round-trip.
    eventStore.add(signed);

    const notifyPubkeys = ownerPubkey !== self ? [ownerPubkey] : [];
    // Fire-and-forget: publishing to the outbox can continue in the background
    // after the event is signed and added to the local store.
    outboxStore
      .publish(signed, buildGroupIds(self, [repoCoord], notifyPubkeys))
      .catch(console.error);
  };
}

/**
 * Change the status of a NIP-34 issue or PR (kinds 1630–1633).
 *
 * Publishes to: user outbox + repo relays + item author's & repo owners' inboxes (deferred).
 */
export function ChangeIssueStatus(
  itemId: string,
  itemAuthorPubkey: string,
  repoCoords: string[],
  nextStatus: Exclude<IssueStatus, "deleted">,
): Action {
  return async ({ factory, sign, self }) => {
    const statusKind = STATUS_KIND_MAP[nextStatus];
    const draft = await factory.create(
      StatusChangeBlueprint,
      statusKind,
      itemId,
      repoCoords,
      itemAuthorPubkey,
      self,
    );
    const signed = await sign(draft);

    // Add to local store immediately so the UI reflects the status change
    // without waiting for a relay round-trip.
    eventStore.add(signed);

    const repoOwners = repoCoords
      .map((c) => c.split(":")[1])
      .filter((pk): pk is string => !!pk);
    const notifyPubkeys = [
      ...new Set([itemAuthorPubkey, ...repoOwners].filter((pk) => pk !== self)),
    ];
    // Fire-and-forget: publishing to the outbox can continue in the background.
    outboxStore
      .publish(signed, buildGroupIds(self, repoCoords, notifyPubkeys))
      .catch(console.error);
  };
}

/**
 * Rename a NIP-34 issue subject via a NIP-32 label event (kind:1985).
 *
 * Publishes to: user outbox + repo relays + item author's inbox (deferred).
 */
export function RenameIssueSubject(
  issueId: string,
  newSubject: string,
  repoCoords?: string[],
  issueAuthorPubkey?: string,
): Action {
  return async ({ factory, sign, self }) => {
    const draft = await factory.create(
      IssueSubjectRenameBlueprint,
      issueId,
      newSubject,
    );
    const signed = await sign(draft);

    // Add to local store immediately so the rename is reflected in the UI
    // without waiting for a relay round-trip.
    eventStore.add(signed);

    const notifyPubkeys =
      issueAuthorPubkey && issueAuthorPubkey !== self
        ? [issueAuthorPubkey]
        : [];
    // Fire-and-forget: publishing to the outbox can continue in the background.
    outboxStore
      .publish(signed, buildGroupIds(self, repoCoords, notifyPubkeys))
      .catch(console.error);
  };
}

/**
 * Attach labels to a NIP-34 issue via a NIP-32 label event (kind:1985).
 *
 * Publishes to: user outbox + repo relays + item author's inbox (deferred).
 */
export function AttachIssueLabels(
  issueId: string,
  labels: string[],
  repoCoords?: string[],
  issueAuthorPubkey?: string,
): Action {
  return async ({ factory, sign, self }) => {
    const draft = await factory.create(IssueLabelBlueprint, issueId, labels);
    const signed = await sign(draft);

    // Add to local store immediately so the label change is reflected in the
    // UI without waiting for a relay round-trip.
    eventStore.add(signed);

    const notifyPubkeys =
      issueAuthorPubkey && issueAuthorPubkey !== self
        ? [issueAuthorPubkey]
        : [];
    // Fire-and-forget: publishing to the outbox can continue in the background.
    outboxStore
      .publish(signed, buildGroupIds(self, repoCoords, notifyPubkeys))
      .catch(console.error);
  };
}

/**
 * React to a NIP-34 event (issue, PR, patch, or comment) with a kind:7
 * reaction event.
 *
 * Publishes to: user outbox + repo relays + event author's inbox (deferred).
 *
 * @param targetEvent - The event being reacted to
 * @param emoji       - Reaction emoji (defaults to "+")
 * @param repoCoords  - Repo coordinate strings for relay group keying
 */
export function CreateReaction(
  targetEvent: NostrEvent,
  emoji: string,
  repoCoords?: string[],
): Action {
  return async ({ factory, sign, self }) => {
    const { ReactionBlueprint } = await import("applesauce-common/blueprints");
    const draft = await factory.create(ReactionBlueprint, targetEvent, emoji);
    const signed = await sign(draft);

    // Add to local store immediately for optimistic UI
    eventStore.add(signed);

    const notifyPubkeys =
      targetEvent.pubkey !== self ? [targetEvent.pubkey] : [];
    // Fire-and-forget: publishing to the outbox can continue in the background.
    outboxStore
      .publish(signed, buildGroupIds(self, repoCoords, notifyPubkeys))
      .catch(console.error);
  };
}

/** Extended options for CreateComment — adds extraTags on top of CommentBlueprintOptions. */
export interface CreateCommentOptions extends CommentOptions {
  /**
   * Additional raw tags to append verbatim (e.g. NIP-94 `imeta` tags from
   * Blossom uploads). Each element is a tag tuple like `["imeta", "url ...", ...]`.
   */
  extraTags?: string[][];
}

/**
 * Post a NIP-22 comment (kind:1111) on a NIP-34 issue, PR/patch, or an
 * existing comment.
 *
 * Publishes to: user outbox + repo relays + root event author's inbox +
 * parent comment author's inbox (both deferred via outbox re-resolution).
 *
 * @param parent    - The event being commented on (root issue/PR or a comment)
 * @param content   - Markdown body of the comment
 * @param rootEvent - The root issue/PR/patch event — used to notify its author
 *                    when `parent` is a reply-to-comment rather than the root itself
 * @param options   - Optional options (alt, expiration, extraTags, etc.)
 */
export function CreateComment(
  parent: NostrEvent,
  content: string,
  rootEvent?: NostrEvent,
  options?: CreateCommentOptions,
): Action {
  return async ({ factory, sign, self }) => {
    const { extraTags, ...blueprintOptions } = options ?? {};
    const draft = await factory.create(
      CommentBlueprint,
      parent,
      content,
      blueprintOptions,
    );
    // Append imeta / extra tags that CommentBlueprint doesn't handle natively
    if (extraTags && extraTags.length > 0) {
      draft.tags = [...draft.tags, ...extraTags];
    }
    const signed = await sign(draft);

    // Add to local store immediately so the comment appears in the thread
    // without waiting for a relay round-trip.
    eventStore.add(signed);

    // Prefer the root event's 'a' tag (always the issue/PR); fall back to
    // the parent's 'a' tag. Comments (kind:1111) don't have 'a' tags so
    // without this we'd lose the coord when replying to a comment.
    const rootRepoCoord = (rootEvent ?? parent).tags.find(
      ([t]) => t === "a",
    )?.[1];
    const repoCoords = rootRepoCoord ? [rootRepoCoord] : undefined;

    // Notify the root event author and (if different) the parent comment
    // author. rootEvent.pubkey is the PR/patch/issue author; when parent IS
    // the root they're the same person.
    const rootPubkey = rootEvent?.pubkey ?? parent.pubkey;
    const notifyPubkeys = [
      ...new Set([rootPubkey, parent.pubkey].filter((pk) => pk !== self)),
    ];

    // Fire-and-forget: publishing to the outbox can continue in the background.
    outboxStore
      .publish(signed, buildGroupIds(self, repoCoords, notifyPubkeys))
      .catch(console.error);
  };
}

/**
 * Create or update a cover note (kind:1624) for a NIP-34 issue or PR.
 *
 * A cover note is a pinned note posted by the item author or a maintainer
 * that appears above the first description card on an issue or PR page.
 *
 * Publishes to: user outbox + repo relays + item author's inbox (deferred).
 *
 * @param rootEvent  - The root issue / PR / patch event being annotated
 * @param content    - Markdown body of the cover note
 * @param repoCoords - Repo coordinate strings for relay group keying
 * @param options    - Optional: extraTags (e.g. imeta from Blossom uploads)
 */
export function CreateCoverNote(
  rootEvent: NostrEvent,
  content: string,
  repoCoords?: string[],
  options?: CoverNoteOptions,
): Action {
  return async ({ factory, sign, self }) => {
    const draft = await factory.create(
      CoverNoteBlueprint,
      rootEvent,
      content,
      options,
    );
    const signed = await sign(draft);

    // Add to local store immediately so the cover note appears without
    // waiting for a relay round-trip.
    eventStore.add(signed);

    const notifyPubkeys = rootEvent.pubkey !== self ? [rootEvent.pubkey] : [];
    // Fire-and-forget: publishing to the outbox can continue in the background.
    outboxStore
      .publish(signed, buildGroupIds(self, repoCoords, notifyPubkeys))
      .catch(console.error);
  };
}

/**
 * Send a NIP-09 deletion request (kind:5) for one or more events.
 *
 * The deletion request is published to the same relay groups as the original
 * event was published to, so every relay holding the event receives the request:
 *   - user outbox (always)
 *   - repo relays (when repoCoords are provided)
 *   - inbox relays of any pubkeys tagged in the original events — these are
 *     the same notification targets that received the event, derived from the
 *     p/P tags on the events being deleted (e.g. root author on comments,
 *     target author on reactions, item author + repo owners on status changes).
 *
 * @param events     - The event(s) to request deletion of (must be authored by self)
 * @param repoCoords - Repo coordinate strings for relay group keying
 * @param reason     - Optional human-readable reason (written to content field)
 */
export function DeleteEvent(
  events: NostrEvent[],
  repoCoords?: string[],
  reason?: string,
): Action {
  return async ({ factory, sign, self }) => {
    // Validate: all events must be authored by the signer
    for (const ev of events) {
      if (ev.pubkey !== self) {
        throw new Error(
          `Cannot delete event ${ev.id.slice(0, 8)}: not authored by current account`,
        );
      }
    }

    const draft = await factory.create(DeletionBlueprint, events, reason);
    const signed = await sign(draft);

    // Add to local store immediately so the UI can react
    eventStore.add(signed);

    // Derive notification pubkeys from the events being deleted.
    // The original publish sent to inbox:<pubkey> for every p/P tag on the
    // event (e.g. root author on comments, target author on reactions, item
    // author + repo owners on status changes). We must reach those same relays
    // with the deletion request.
    const notifyPubkeys = new Set<string>();
    for (const ev of events) {
      for (const [t, pk] of ev.tags) {
        if ((t === "p" || t === "P") && pk && pk !== self) {
          notifyPubkeys.add(pk);
        }
      }
    }

    // Fire-and-forget: publishing to the outbox can continue in the background.
    outboxStore
      .publish(signed, buildGroupIds(self, repoCoords, [...notifyPubkeys]))
      .catch(console.error);
  };
}

/**
 * Post an inline code review comment (kind:1111) on a NIP-34 PR or patch.
 *
 * Extends the standard NIP-22 comment with file/line/commit location tags as
 * defined in NIP.md. Publishes to the same relay groups as CreateComment.
 *
 * @param rootEvent    - The PR (kind:1618) or patch (kind:1617) being reviewed
 * @param parentEvent  - Immediate parent (same as rootEvent, or a PR update)
 * @param content      - Comment body
 * @param options      - Code location: filePath, commitId, line, repoCoords
 */
export function CreateInlineComment(
  rootEvent: NostrEvent,
  parentEvent: NostrEvent,
  content: string,
  options: InlineCommentOptions,
): Action {
  return async ({ sign, self }) => {
    const draft = buildInlineCommentTemplate(
      rootEvent,
      parentEvent,
      content,
      options,
    );
    const signed = await sign(draft);

    // Add to local store immediately so the comment appears without a relay round-trip.
    eventStore.add(signed);

    const repoCoords = options.repoCoords;
    const notifyPubkeys = [
      ...new Set(
        [rootEvent.pubkey, parentEvent.pubkey].filter((pk) => pk !== self),
      ),
    ];

    outboxStore
      .publish(signed, buildGroupIds(self, repoCoords, notifyPubkeys))
      .catch(console.error);
  };
}

/**
 * Send a NIP-09 deletion request (kind:5) for a repository announcement.
 *
 * Two modes:
 *   - "version": deletes only the specific event version via an `e` tag
 *   - "repo":    deletes the entire repository (all versions) via an `a` tag
 *
 * @param announcement - The current announcement event (kind:30617)
 * @param mode         - "version" to delete just this event; "repo" to delete all versions
 * @param repoCoords   - Repo coordinate strings for relay group keying
 * @param reason       - Optional human-readable reason
 */
export function DeleteRepo(
  announcement: NostrEvent,
  mode: "version" | "repo",
  repoCoords?: string[],
  reason?: string,
): Action {
  return async ({ factory, sign, self }) => {
    if (announcement.pubkey !== self) {
      throw new Error(
        `Cannot delete repo announcement ${announcement.id.slice(0, 8)}: not authored by current account`,
      );
    }

    let draft;
    if (mode === "version") {
      // Delete only this specific event version via `e` tag
      draft = await factory.create(DeletionBlueprint, [announcement], reason);
    } else {
      // Delete the entire repository (all versions) via `a` tag
      const dTag = announcement.tags.find(([t]) => t === "d")?.[1] ?? "";
      const aCoord = `${announcement.kind}:${announcement.pubkey}:${dTag}`;
      draft = await factory.create(
        AddressableDeletionBlueprint,
        aCoord,
        announcement.kind,
        reason,
      );
    }

    const signed = await sign(draft);

    // Add to local store immediately so the UI can react
    eventStore.add(signed);

    // Publish to user outbox + repo relays + git index relay.
    // The git index (wss://index.ngit.dev) holds repo announcements and must
    // receive the deletion request so it stops serving the event to other clients.
    outboxStore
      .publish(signed, [...buildGroupIds(self, repoCoords), "git-index"])
      .catch(console.error);
  };
}
