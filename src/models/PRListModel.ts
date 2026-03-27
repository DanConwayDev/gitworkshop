import { combineLatest, of } from "rxjs";
import { auditTime, switchMap, map } from "rxjs/operators";
import type { Model } from "applesauce-core/event-store";
import {
  PATCH_KIND,
  PR_KIND,
  PR_UPDATE_KIND,
  LABEL_KIND,
  DELETION_KIND,
  STATUS_KINDS,
  COMMENT_KIND,
  pubkeyFromCoordinate,
  buildResolvedPRs,
  type ResolvedPRLite,
} from "@/lib/nip34";
import { hasNameValueTag, type Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";

/** All essential kinds fetched alongside PRs/patches. */
const ESSENTIALS_KINDS = [...STATUS_KINDS, LABEL_KIND, DELETION_KIND] as const;

/**
 * PRListModel — subscribes to patches (kind:1617) and PRs (kind:1618) and
 * their essentials, comment, and zap events in the store and emits a
 * fully-resolved list of ResolvedPRLite objects.
 *
 * Structurally identical to IssueListModel but:
 * - Queries kinds [1617, 1618] instead of [1621]
 * - Filters patches to root-only (t:root tag) in the final build step
 * - Passes mergeStatusRequiresMaintainer=true via buildResolvedPRLites
 *
 * Cache key: the sorted, comma-joined coordinate string (same as IssueListModel).
 *
 * @param coordsCacheKey - Sorted, comma-joined coordinate string (cache key)
 */
export function PRListModel(coordsCacheKey: string): Model<ResolvedPRLite[]> {
  return (store) => {
    const coords = coordsCacheKey ? coordsCacheKey.split(",") : [];
    const maintainerSet = new Set<string>(
      coords.flatMap((c) => {
        const pk = pubkeyFromCoordinate(c);
        return pk ? [pk] : [];
      }),
    );

    const prFilter: Filter[] = [
      { kinds: [PATCH_KIND, PR_KIND], "#a": coords } as Filter,
    ];

    return store.timeline(prFilter).pipe(
      auditTime(100),

      switchMap((prEvents) => {
        // Filter to root patches only (PRs are always included).
        // A root patch has t:root but NOT t:root-revision or t:revision-root.
        // Revision root patches have both t:root and t:root-revision — they
        // belong to the original root patch's thread, not as separate list entries.
        const events = (prEvents as NostrEvent[]).filter(
          (ev) =>
            ev.kind === PR_KIND ||
            (ev.kind === PATCH_KIND &&
              hasNameValueTag(ev, "t", "root") &&
              !hasNameValueTag(ev, "t", "root-revision") &&
              !hasNameValueTag(ev, "t", "revision-root")),
        );
        if (events.length === 0) return of([] as ResolvedPRLite[]);

        const ids = events.map((e) => e.id);

        const essentials$ = store.timeline([
          { kinds: [...ESSENTIALS_KINDS], "#e": ids } as Filter,
        ]);
        // Comments (kind:1111) and PR Updates (kind:1619) both use the
        // uppercase E root tag. Split them here so PR Updates don't inflate
        // comment counts but still factor into lastActivityAt.
        const commentsAndUpdates$ = store.timeline([
          { kinds: [COMMENT_KIND, PR_UPDATE_KIND], "#E": ids } as Filter,
        ]);
        const zaps$ = store.timeline([{ kinds: [9735], "#e": ids } as Filter]);

        return combineLatest([essentials$, commentsAndUpdates$, zaps$]).pipe(
          map(([essentialEvents, commentsAndUpdates, zapEvents]) => {
            const allCommentEvents = commentsAndUpdates as NostrEvent[];
            const commentEvents = allCommentEvents.filter(
              (ev) => ev.kind === COMMENT_KIND,
            );
            const prUpdateEvents = allCommentEvents.filter(
              (ev) => ev.kind === PR_UPDATE_KIND,
            );
            return buildResolvedPRs(
              events,
              essentialEvents as NostrEvent[],
              commentEvents,
              zapEvents as NostrEvent[],
              maintainerSet,
              prUpdateEvents,
            );
          }),
        );
      }),
    );
  };
}
