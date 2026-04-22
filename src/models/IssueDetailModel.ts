import { combineLatest, of } from "rxjs";
import {
  auditTime,
  distinctUntilChanged,
  map,
  switchMap,
} from "rxjs/operators";
import type { Model } from "applesauce-core/event-store";
import type { NostrEvent } from "nostr-tools";
import type { Filter } from "applesauce-core/helpers";
import {
  ISSUE_KIND,
  LABEL_KIND,
  DELETION_KIND,
  STATUS_KINDS,
  COMMENT_KIND,
  LEGACY_REPLY_KINDS,
  COVER_NOTE_KIND,
  resolveItemEssentials,
  extractBody,
  buildRenameItems,
  buildTimelineNodes,
  resolveCoverNotes,
  type ResolvedIssue,
} from "@/lib/nip34";

/**
 * IssueDetailModel — reactively resolves the full detail-page view of a single
 * issue (kind:1621).
 *
 * Subscribes to the EventStore for:
 * - The root event (kind:1621)
 * - Essentials (status, labels, deletions)
 * - Comments (kind:1111 via #E, legacy kinds 1/1622 via #e)
 * - Cover notes (kind:1624 via #E)
 * - Zaps (kind:9735)
 *
 * Emits a `ResolvedIssue` whenever any of these change.
 *
 * @param rootId      - The event ID of the root issue
 * @param maintainers - The effective maintainer set (from repo resolution)
 */
export function IssueDetailModel(
  rootId: string,
  maintainers: Set<string> | undefined,
): Model<ResolvedIssue | undefined> {
  return (store) => {
    // All essential kinds fetched per-item
    const ESSENTIALS_KINDS = [
      ...STATUS_KINDS,
      LABEL_KIND,
      DELETION_KIND,
    ] as const;

    // Root event (kind:1621)
    const root$ = store.timeline([{ kinds: [ISSUE_KIND], ids: [rootId] }]);

    // Essentials (status, labels, deletions)
    const essentials$ = store.timeline([
      { kinds: [...ESSENTIALS_KINDS], "#e": [rootId] } as Filter,
    ]);

    // Comments (kind:1111) rooted at this issue via NIP-22 #E tag
    const comments$ = store.timeline([
      { kinds: [COMMENT_KIND], "#E": [rootId] } as Filter,
    ]);

    // Legacy replies (kind 1, 1622) via NIP-10 #e tag
    const legacyReplies$ = store.timeline([
      { kinds: [...LEGACY_REPLY_KINDS], "#e": [rootId] } as Filter,
    ]);

    // Cover notes (kind:1624) referencing this issue via lowercase #e tag
    const coverNotes$ = store.timeline([
      { kinds: [COVER_NOTE_KIND], "#e": [rootId] } as Filter,
    ]);

    // Zaps
    const zaps$ = store.timeline([{ kinds: [9735], "#e": [rootId] } as Filter]);

    // Deletion events for all essential events (status, label/rename).
    // Derived reactively from essentials$: extract all non-deletion essential
    // event IDs, then query for kind:5 deletions referencing those IDs.
    // Re-subscribes automatically whenever the set of essential IDs changes.
    const essentialDeletions$ = essentials$.pipe(
      map((evs) =>
        (evs as NostrEvent[])
          .filter((e) => e.kind !== DELETION_KIND)
          .map((e) => e.id),
      ),
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
      ),
      switchMap((essentialIds) => {
        if (essentialIds.length === 0) return of([] as NostrEvent[]);
        return store
          .timeline([{ kinds: [DELETION_KIND], "#e": essentialIds } as Filter])
          .pipe(map((evs) => evs as NostrEvent[]));
      }),
    );

    return combineLatest([
      root$,
      essentials$,
      comments$,
      legacyReplies$,
      coverNotes$,
      zaps$,
      essentialDeletions$,
    ]).pipe(
      auditTime(50),
      map(
        ([
          rootEvents,
          essentialEvents,
          commentEvents,
          legacyReplyEvents,
          coverNoteEvents,
          zapEvents,
          essentialDeletionEvents,
        ]) => {
          const roots = rootEvents as NostrEvent[];
          const rootEvent = roots[0];
          if (!rootEvent) return undefined;

          const essentials = essentialEvents as NostrEvent[];
          // Merge NIP-22 comments and legacy replies into a single list
          const allComments = [
            ...(commentEvents as NostrEvent[]),
            ...(legacyReplyEvents as NostrEvent[]),
          ];
          const coverNotes = coverNoteEvents as NostrEvent[];
          const zaps = zapEvents as NostrEvent[];

          // Effective maintainer set (use provided or empty while loading)
          const effectiveMaintainers = maintainers ?? new Set<string>();

          // Resolve core essentials using the shared pure function
          const core = resolveItemEssentials(
            rootEvent,
            essentials,
            allComments,
            zaps,
            effectiveMaintainers,
            {
              essentialDeletionEvents: essentialDeletionEvents as NostrEvent[],
            },
          );

          // ── Cover note ─────────────────────────────────────────────
          const allCoverNotes = resolveCoverNotes(
            rootId,
            rootEvent.pubkey,
            coverNotes,
            core.authorisedUsers,
          );
          const coverNote = allCoverNotes[0];

          // ── Build rename items ──────────────────────────────────────
          const renameItems = buildRenameItems(
            core.originalSubject,
            core.subjectRenames,
            essentials,
          );

          // ── Build timeline nodes ────────────────────────────────────
          const timelineNodes = buildTimelineNodes({
            itemType: "issue",
            rootEvent,
            comments: allComments,
            essentials,
            authorisedUsers: core.authorisedUsers,
            deletedEssentialEventIds: core.deletedEssentialEventIds,
          });

          // ── Participants ────────────────────────────────────────────
          const participantSet = new Set<string>();
          participantSet.add(rootEvent.pubkey);
          for (const c of allComments) participantSet.add(c.pubkey);

          return {
            // Core fields from resolveItemEssentials
            id: core.id,
            pubkey: core.pubkey,
            event: core.event,
            originalSubject: core.originalSubject,
            currentSubject: core.currentSubject,
            content: core.content,
            createdAt: core.createdAt,
            lastActivityAt: core.lastActivityAt,
            status: core.status,
            labels: core.labels,
            repoCoords: core.repoCoords,
            commentCount: allComments.length,
            participantCount: participantSet.size,
            zapTotal: core.zapTotal,
            authorisedUsers: core.authorisedUsers,
            deletedEssentialEventIds: core.deletedEssentialEventIds,

            // Detail fields
            body: extractBody(rootEvent),
            coverNote,
            coverNotes: allCoverNotes,
            timelineNodes,
            comments: allComments,
            zaps,
            renameItems,
            participants: Array.from(participantSet),
            rootEvent,
            maintainers: effectiveMaintainers,
          } satisfies ResolvedIssue;
        },
      ),
    );
  };
}
