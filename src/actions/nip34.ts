/**
 * NIP-34 Actions — CreateIssue, ChangeIssueStatus, RenameIssueSubject.
 *
 * These are proper applesauce Action functions. They use the action context to:
 *   1. Get the current user's NIP-65 outbox relays (where their events should live)
 *   2. Accept repo-declared relays as a parameter (where the repo's events live)
 *   3. Derive tagged-pubkey inbox relays for notification delivery
 *
 * The publish() call in each action receives a relay-groups map so the outbox
 * store can track per-relay success and retry failed relays.
 *
 * Relay selection strategy:
 *   - "your outbox"  → user's NIP-65 write relays (kind:10002 outboxes)
 *   - "repo relays"  → relays declared in the repository announcement
 *   - "git index"    → wss://index.ngit.dev (always included as fallback)
 *
 * The outbox store (src/services/outbox.ts) receives the relay groups map and
 * tracks per-relay success, retrying rate-limited relays automatically.
 */

import type { Action } from "applesauce-actions";
import { IssueBlueprint, type IssueOptions } from "@/blueprints/issue";
import { StatusChangeBlueprint, STATUS_KIND_MAP } from "@/blueprints/status";
import {
  IssueSubjectRenameBlueprint,
  IssueLabelBlueprint,
} from "@/blueprints/label";
import type { IssueStatus } from "@/lib/nip34";
import { gitIndexRelays } from "@/services/settings";
import { outboxStore } from "@/services/outbox";
import { eventStore } from "@/services/nostr";
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
 * Returns an empty array if no kind:10002 event is found within 500ms.
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
 * Get the inbox relays for a set of pubkeys (for notification delivery).
 * Returns a flat deduplicated array.
 */
async function getInboxRelaysForPubkeys(pubkeys: string[]): Promise<string[]> {
  const results = await Promise.all(
    pubkeys.map(async (pubkey) => {
      try {
        const mailboxes = await firstValueFrom(
          eventStore
            .model(MailboxesModel, pubkey)
            .pipe(timeout({ first: 500, with: () => of(undefined) })),
        );
        return mailboxes?.inboxes.slice(0, MAX_INBOX_RELAYS) ?? [];
      } catch {
        return [];
      }
    }),
  );
  // Deduplicate
  return [...new Set(results.flat())];
}

/**
 * Build the relay groups map for a NIP-34 event publish.
 *
 * @param signerPubkey  - The publishing user's pubkey
 * @param repoRelays    - Relays declared in the repository announcement
 * @param notifyPubkeys - Pubkeys to notify (their inbox relays are included)
 */
async function buildRelayGroups(
  signerPubkey: string,
  repoRelays: string[],
  notifyPubkeys: string[],
): Promise<Record<string, string[]>> {
  const [userOutboxes, notifyInboxes] = await Promise.all([
    getUserOutboxRelays(signerPubkey),
    getInboxRelaysForPubkeys(notifyPubkeys),
  ]);

  const gitIndex = gitIndexRelays.getValue();

  const groups: Record<string, string[]> = {};

  // Always include git index as a reliable fallback
  if (gitIndex.length > 0) {
    groups["git index"] = gitIndex;
  }

  // User's own outbox relays
  if (userOutboxes.length > 0) {
    groups["your outbox"] = userOutboxes;
  }

  // Repo-declared relays
  if (repoRelays.length > 0) {
    groups["repo relays"] = repoRelays;
  }

  // Notification inboxes for tagged pubkeys
  if (notifyInboxes.length > 0) {
    groups["notification inboxes"] = notifyInboxes;
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Create a NIP-34 git issue (kind:1621).
 *
 * Publishes to: git index + user's outbox relays + repo relays + owner's inbox.
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

    const notifyPubkeys = ownerPubkey !== self ? [ownerPubkey] : [];
    const relayGroups = await buildRelayGroups(self, repoRelays, notifyPubkeys);

    await outboxStore.publish(signed, relayGroups);
    // Also add to local store immediately for optimistic UI
    // (outboxStore.publish fires-and-forgets the relay sends)
  };
}

/**
 * Change the status of a NIP-34 issue or PR (kinds 1630–1633).
 *
 * Publishes to: git index + user's outbox relays + repo relays + item author's inbox.
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

    // Collect all pubkeys to notify: item author + repo owners
    const repoOwners = repoCoords
      .map((c) => c.split(":")[1])
      .filter((pk): pk is string => !!pk);
    const notifyPubkeys = [
      ...new Set([itemAuthorPubkey, ...repoOwners].filter((pk) => pk !== self)),
    ];

    const relayGroups = await buildRelayGroups(self, repoRelays, notifyPubkeys);
    await outboxStore.publish(signed, relayGroups);
  };
}

/**
 * Rename a NIP-34 issue subject via a NIP-32 label event (kind:1985).
 *
 * Publishes to: git index + user's outbox relays + repo relays.
 */
export function RenameIssueSubject(
  issueId: string,
  newSubject: string,
  repoRelays: string[],
): Action {
  return async ({ factory, sign, self }) => {
    const draft = await factory.create(
      IssueSubjectRenameBlueprint,
      issueId,
      newSubject,
    );
    const signed = await sign(draft);

    const relayGroups = await buildRelayGroups(self, repoRelays, []);
    await outboxStore.publish(signed, relayGroups);
  };
}

/**
 * Attach labels to a NIP-34 issue via a NIP-32 label event (kind:1985).
 *
 * Publishes to: git index + user's outbox relays + repo relays.
 */
export function AttachIssueLabels(
  issueId: string,
  labels: string[],
  repoRelays: string[],
): Action {
  return async ({ factory, sign, self }) => {
    const draft = await factory.create(IssueLabelBlueprint, issueId, labels);
    const signed = await sign(draft);

    const relayGroups = await buildRelayGroups(self, repoRelays, []);
    await outboxStore.publish(signed, relayGroups);
  };
}
