import { combineLatest } from "rxjs";
import { auditTime, map } from "rxjs/operators";
import type { Model } from "applesauce-core/event-store";
import type { NostrEvent } from "nostr-tools";
import type { Filter } from "applesauce-core/helpers";
import {
  ISSUE_KIND,
  LABEL_KIND,
  DELETION_KIND,
  STATUS_KINDS,
  COMMENT_KIND,
  resolveItemEssentials,
  extractBody,
  type ResolvedIssue,
  type IssueTimelineNode,
} from "@/lib/nip34";
import { getThreadTree } from "@/lib/threadTree";

/**
 * IssueDetailModel — reactively resolves the full detail-page view of a single
 * issue (kind:1621).
 *
 * Subscribes to the EventStore for:
 * - The root event (kind:1621)
 * - Essentials (status, labels, deletions)
 * - Comments (kind:1111)
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

    // Comments (kind:1111) rooted at this issue
    const comments$ = store.timeline([
      { kinds: [COMMENT_KIND], "#E": [rootId] } as Filter,
    ]);

    // Zaps
    const zaps$ = store.timeline([{ kinds: [9735], "#e": [rootId] } as Filter]);

    return combineLatest([root$, essentials$, comments$, zaps$]).pipe(
      auditTime(50),
      map(([rootEvents, essentialEvents, commentEvents, zapEvents]) => {
        const roots = rootEvents as NostrEvent[];
        const rootEvent = roots[0];
        if (!rootEvent) return undefined;

        const essentials = essentialEvents as NostrEvent[];
        const allComments = commentEvents as NostrEvent[];
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
        );

        // ── Build rename items ──────────────────────────────────────
        const renameItems = buildRenameItems(
          core.originalSubject,
          core.subjectRenames,
          essentials,
        );

        // ── Build timeline nodes ────────────────────────────────────
        const timelineNodes = buildTimelineNodes(
          rootEvent,
          allComments,
          renameItems,
        );

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
          zapCount: core.zapCount,
          authorisedUsers: core.authorisedUsers,

          // Detail fields
          body: extractBody(rootEvent),
          timelineNodes,
          comments: allComments,
          zaps,
          renameItems,
          participants: Array.from(participantSet),
          rootEvent,
          maintainers: effectiveMaintainers,
        } satisfies ResolvedIssue;
      }),
    );
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build rename items with old/new subjects for display.
 */
function buildRenameItems(
  originalSubject: string,
  subjectRenames: { createdAt: number; id: string; value: string }[],
  essentialEvents: NostrEvent[],
): { event: NostrEvent; oldSubject: string; newSubject: string }[] {
  if (subjectRenames.length === 0) return [];

  // Build a map of essential events by ID for quick lookup
  const evById = new Map<string, NostrEvent>();
  for (const ev of essentialEvents) evById.set(ev.id, ev);

  let prevSubject = originalSubject;
  return subjectRenames
    .map((rename) => {
      const ev = evById.get(rename.id);
      if (!ev) return null;
      const item = {
        event: ev,
        oldSubject: prevSubject,
        newSubject: rename.value,
      };
      prevSubject = rename.value;
      return item;
    })
    .filter(
      (
        item,
      ): item is {
        event: NostrEvent;
        oldSubject: string;
        newSubject: string;
      } => item !== null,
    );
}

/**
 * Build the interleaved conversation timeline from comments and rename items.
 */
function buildTimelineNodes(
  rootEvent: NostrEvent,
  comments: NostrEvent[],
  renameItems: { event: NostrEvent; oldSubject: string; newSubject: string }[],
): IssueTimelineNode[] {
  const nodes: IssueTimelineNode[] = [];

  // Thread comments
  const threadTree = getThreadTree(rootEvent, comments);
  if (threadTree) {
    for (const child of threadTree.children) {
      nodes.push({
        type: "thread",
        node: child,
        ts: child.event.created_at,
      });
    }
  }

  // Subject renames
  for (const item of renameItems) {
    nodes.push({
      type: "rename",
      event: item.event,
      oldSubject: item.oldSubject,
      newSubject: item.newSubject,
      ts: item.event.created_at,
    });
  }

  // Sort chronologically with stable tie-break
  nodes.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    // renames before threads at the same timestamp
    const typeOrder = (t: IssueTimelineNode["type"]) =>
      t === "rename" ? 0 : 1;
    return typeOrder(a.type) - typeOrder(b.type);
  });

  return nodes;
}
