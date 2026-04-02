/**
 * NIP-34 Actions — CreateIssue, ChangeIssueStatus, RenameIssueSubject, CreateComment.
 *
 * Relay strategy — callers declare intent via group ID strings; the outbox
 * store resolves them to relay URLs via its relayGroupResolver:
 *
 *   - "outbox:<signerPubkey>"  → user's NIP-65 write relays
 *   - "30617:<pubkey>:<d>"     → repo's declared relays (one per coord)
 *   - "inbox:<notifyPubkey>"   → notification recipient's NIP-65 read relays
 *                                (resolved lazily; retried when kind:10002 arrives)
 *
 * The git index (wss://index.ngit.dev) is intentionally NOT a publish target —
 * it syncs from other relays and should not receive direct publishes.
 */

import type { Action } from "applesauce-actions";
import type { NostrEvent } from "nostr-tools";
import { IssueBlueprint, type IssueOptions } from "@/blueprints/issue";
import { CommentBlueprint, type CommentOptions } from "@/blueprints/comment";
import { StatusChangeBlueprint, STATUS_KIND_MAP } from "@/blueprints/status";
import {
  IssueSubjectRenameBlueprint,
  IssueLabelBlueprint,
} from "@/blueprints/label";
import { DeletionBlueprint } from "@/blueprints/deletion";
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
    await outboxStore.publish(
      signed,
      buildGroupIds(self, [repoCoord], notifyPubkeys),
    );
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
    await outboxStore.publish(
      signed,
      buildGroupIds(self, repoCoords, notifyPubkeys),
    );
  };
}

/**
 * Rename a NIP-34 issue subject via a NIP-32 label event (kind:1985).
 *
 * Publishes to: user outbox + repo relays. No notification needed.
 */
export function RenameIssueSubject(
  issueId: string,
  newSubject: string,
  repoCoords?: string[],
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

    await outboxStore.publish(signed, buildGroupIds(self, repoCoords));
  };
}

/**
 * Attach labels to a NIP-34 issue via a NIP-32 label event (kind:1985).
 *
 * Publishes to: user outbox + repo relays. No notification needed.
 */
export function AttachIssueLabels(
  issueId: string,
  labels: string[],
  repoCoords?: string[],
): Action {
  return async ({ factory, sign, self }) => {
    const draft = await factory.create(IssueLabelBlueprint, issueId, labels);
    const signed = await sign(draft);

    // Add to local store immediately so the label change is reflected in the
    // UI without waiting for a relay round-trip.
    eventStore.add(signed);

    await outboxStore.publish(signed, buildGroupIds(self, repoCoords));
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
    await outboxStore.publish(
      signed,
      buildGroupIds(self, repoCoords, notifyPubkeys),
    );
  };
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
 * @param options   - Optional CommentBlueprintOptions (alt, expiration, etc.)
 */
export function CreateComment(
  parent: NostrEvent,
  content: string,
  rootEvent?: NostrEvent,
  options?: CommentOptions,
): Action {
  return async ({ factory, sign, self }) => {
    const draft = await factory.create(
      CommentBlueprint,
      parent,
      content,
      options,
    );
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

    await outboxStore.publish(
      signed,
      buildGroupIds(self, repoCoords, notifyPubkeys),
    );
  };
}

/**
 * Send a NIP-09 deletion request (kind:5) for one or more events.
 *
 * The deletion request is published to the same relay groups as the original
 * event so relays that hold the event receive the request.
 *
 * Publishes to: user outbox + repo relays. No notification needed.
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

    await outboxStore.publish(signed, buildGroupIds(self, repoCoords));
  };
}
