/**
 * NIP-34 Actions — CreateIssue, ChangeIssueStatus, RenameIssueSubject, CreateComment.
 *
 * Relay strategy (two-phase):
 *
 *   Phase 1 — immediate publish (synchronous, no network wait):
 *     - "your outbox"  → user's NIP-65 write relays (kind:10002 outboxes)
 *     - "repo relays"  → relays declared in the repository announcement
 *
 *   Phase 2 — deferred notification delivery (async, after phase 1 returns):
 *     - "notification inboxes" → inbox relays of pubkeys being notified
 *       (fetched via addressLoader if not already in the EventStore)
 *
 * The git index (wss://index.ngit.dev) is intentionally NOT a publish target —
 * it syncs from other relays and should not receive direct publishes.
 *
 * Phase 2 uses outboxStore.addRelays() so the outbox panel shows the inbox
 * relays appearing and being sent to after the initial publish completes.
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
import type { IssueStatus } from "@/lib/nip34";
import { outboxStore } from "@/services/outbox";
import { eventStore, addressLoader } from "@/services/nostr";
import { MailboxesModel } from "applesauce-core/models";
import { firstValueFrom, of, timeout } from "rxjs";

// ---------------------------------------------------------------------------
// Relay resolution helpers
// ---------------------------------------------------------------------------

/** Max outbox relays to use from the user's NIP-65 list */
const MAX_OUTBOX_RELAYS = 5;

/** Max inbox relays to use per tagged pubkey */
const MAX_INBOX_RELAYS = 3;

/**
 * Get the current user's NIP-65 outbox relays from the EventStore.
 * The user's own kind:10002 is loaded on login so this should always hit
 * the cache. Falls back to empty if not found within 500ms.
 */
async function getUserOutboxRelays(pubkey: string): Promise<string[]> {
  try {
    const mailboxes = await firstValueFrom(
      eventStore
        .model(MailboxesModel, pubkey)
        .pipe(timeout({ first: 500, with: () => of(undefined) })),
    );
    return mailboxes?.outboxes.slice(0, MAX_OUTBOX_RELAYS) ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch inbox relays for a set of pubkeys (for notification delivery).
 *
 * Triggers an addressLoader fetch for each pubkey's kind:10002 in parallel
 * with reading from the EventStore. The addressLoader writes the result into
 * the store as a side-effect, so MailboxesModel picks it up once it arrives.
 * A 3-second timeout gives relay round-trips time to complete.
 *
 * Returns a map of pubkey → relay URLs (one entry per pubkey that has inbox
 * relays). Keying by pubkey lets the outbox store re-resolve each recipient's
 * inbox independently when their relay list changes.
 */
async function resolveNotificationInboxes(
  pubkeys: string[],
): Promise<Record<string, string[]>> {
  if (pubkeys.length === 0) return {};

  const groups: Record<string, string[]> = {};

  await Promise.all(
    pubkeys.map(async (pubkey) => {
      try {
        // Kick off a relay fetch. addressLoader writes into the EventStore as
        // a side-effect; we don't await it — the MailboxesModel timeout below
        // is the deadline.
        const fetchSub = addressLoader({ kind: 10002, pubkey }).subscribe();

        const mailboxes = await firstValueFrom(
          eventStore
            .model(MailboxesModel, pubkey)
            .pipe(timeout({ first: 3000, with: () => of(undefined) })),
        );

        fetchSub.unsubscribe();
        const inboxes = mailboxes?.inboxes.slice(0, MAX_INBOX_RELAYS) ?? [];
        if (inboxes.length > 0) {
          groups[pubkey] = inboxes;
        }
      } catch {
        // ignore
      }
    }),
  );

  return groups;
}

/**
 * Build the immediate (phase 1) relay groups: user outbox + repo relays.
 * Both are available synchronously — no network wait required.
 *
 * Group IDs use semantic identifiers so the outbox store can re-resolve them
 * when relay lists change:
 *   - signerPubkey → user's own NIP-65 outbox relays
 *   - repoCoord    → repo's declared relays (one entry per coord)
 */
async function buildImmediateRelayGroups(
  signerPubkey: string,
  repoRelays: string[],
  repoCoords?: string[],
): Promise<Record<string, string[]>> {
  const userOutboxes = await getUserOutboxRelays(signerPubkey);

  const groups: Record<string, string[]> = {};

  if (userOutboxes.length > 0) {
    // Keyed by pubkey so the outbox store can re-resolve via MailboxesModel
    groups[signerPubkey] = userOutboxes;
  }

  if (repoRelays.length > 0) {
    if (repoCoords && repoCoords.length > 0) {
      // Key each repo coord separately so coverage is tracked per-repo
      for (const coord of repoCoords) {
        groups[coord] = repoRelays;
      }
    } else {
      // Fallback: no coord available, use a well-known string
      groups["repo relays"] = repoRelays;
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Create a NIP-34 git issue (kind:1621).
 *
 * Phase 1: user outbox + repo relays (immediate).
 * Phase 2: repo owner's inbox relays (deferred).
 */
export function CreateIssue(
  repoCoord: string,
  ownerPubkey: string,
  subject: string,
  content: string,
  repoRelays: string[],
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

    // Phase 1 — publish immediately
    const immediateGroups = await buildImmediateRelayGroups(self, repoRelays, [
      repoCoord,
    ]);
    await outboxStore.publish(signed, immediateGroups);

    // Phase 2 — notify owner's inbox relays (fire-and-forget)
    // Keyed by pubkey so the outbox store can re-resolve via MailboxesModel
    const notifyPubkeys = ownerPubkey !== self ? [ownerPubkey] : [];
    if (notifyPubkeys.length > 0) {
      resolveNotificationInboxes(notifyPubkeys).then((inboxGroups) => {
        if (Object.keys(inboxGroups).length > 0) {
          outboxStore.addRelays(signed.id, inboxGroups);
        }
      });
    }
  };
}

/**
 * Change the status of a NIP-34 issue or PR (kinds 1630–1633).
 *
 * Phase 1: user outbox + repo relays (immediate).
 * Phase 2: item author's + repo owners' inbox relays (deferred).
 */
export function ChangeIssueStatus(
  itemId: string,
  itemAuthorPubkey: string,
  repoCoords: string[],
  nextStatus: Exclude<IssueStatus, "deleted">,
  repoRelays: string[],
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

    // Phase 1 — publish immediately
    const immediateGroups = await buildImmediateRelayGroups(
      self,
      repoRelays,
      repoCoords,
    );
    await outboxStore.publish(signed, immediateGroups);

    // Phase 2 — notify item author + repo owners (fire-and-forget)
    // Keyed by pubkey so the outbox store can re-resolve via MailboxesModel
    const repoOwners = repoCoords
      .map((c) => c.split(":")[1])
      .filter((pk): pk is string => !!pk);
    const notifyPubkeys = [
      ...new Set([itemAuthorPubkey, ...repoOwners].filter((pk) => pk !== self)),
    ];
    if (notifyPubkeys.length > 0) {
      resolveNotificationInboxes(notifyPubkeys).then((inboxGroups) => {
        if (Object.keys(inboxGroups).length > 0) {
          outboxStore.addRelays(signed.id, inboxGroups);
        }
      });
    }
  };
}

/**
 * Rename a NIP-34 issue subject via a NIP-32 label event (kind:1985).
 *
 * Phase 1: user outbox + repo relays (immediate). No notification needed.
 */
export function RenameIssueSubject(
  issueId: string,
  newSubject: string,
  repoRelays: string[],
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

    const immediateGroups = await buildImmediateRelayGroups(
      self,
      repoRelays,
      repoCoords,
    );
    await outboxStore.publish(signed, immediateGroups);
  };
}

/**
 * Attach labels to a NIP-34 issue via a NIP-32 label event (kind:1985).
 *
 * Phase 1: user outbox + repo relays (immediate). No notification needed.
 */
export function AttachIssueLabels(
  issueId: string,
  labels: string[],
  repoRelays: string[],
  repoCoords?: string[],
): Action {
  return async ({ factory, sign, self }) => {
    const draft = await factory.create(IssueLabelBlueprint, issueId, labels);
    const signed = await sign(draft);

    // Add to local store immediately so the label change is reflected in the
    // UI without waiting for a relay round-trip.
    eventStore.add(signed);

    const immediateGroups = await buildImmediateRelayGroups(
      self,
      repoRelays,
      repoCoords,
    );
    await outboxStore.publish(signed, immediateGroups);
  };
}

/**
 * Post a NIP-22 comment (kind:1111) on a NIP-34 issue, PR/patch, or an
 * existing comment.
 *
 * Phase 1: user outbox + repo relays (immediate).
 * Phase 2: root event author's + parent comment author's inbox relays (deferred).
 *
 * @param parent     - The event being commented on (root issue/PR or a comment)
 * @param content    - Markdown body of the comment
 * @param repoRelays - Relays declared in the repository announcement
 * @param rootEvent  - The root issue/PR/patch event — used to notify its author
 *                     when `parent` is a reply-to-comment rather than the root itself
 * @param options    - Optional CommentBlueprintOptions (alt, expiration, etc.)
 */
export function CreateComment(
  parent: NostrEvent,
  content: string,
  repoRelays: string[],
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

    // Phase 1 — publish immediately to user outbox + repo relays
    // Prefer the root event's 'a' tag (always the issue/PR); fall back to
    // the parent's 'a' tag. Comments (kind:1111) don't have 'a' tags so
    // without this we'd lose the coord when replying to a comment.
    const rootRepoCoord = (rootEvent ?? parent).tags.find(
      ([t]) => t === "a",
    )?.[1];
    const repoCoords = rootRepoCoord ? [rootRepoCoord] : undefined;
    const immediateGroups = await buildImmediateRelayGroups(
      self,
      repoRelays,
      repoCoords,
    );
    await outboxStore.publish(signed, immediateGroups);

    // Phase 2 — notify the root event author and (if different) the parent
    // comment author. rootEvent.pubkey is the PR/patch/issue author; when
    // parent IS the root they're the same person.
    const rootPubkey = rootEvent?.pubkey ?? parent.pubkey;
    const notifyPubkeys = [
      ...new Set([rootPubkey, parent.pubkey].filter((pk) => pk !== self)),
    ];
    if (notifyPubkeys.length > 0) {
      resolveNotificationInboxes(notifyPubkeys).then((inboxGroups) => {
        if (Object.keys(inboxGroups).length > 0) {
          outboxStore.addRelays(signed.id, inboxGroups);
        }
      });
    }
  };
}
