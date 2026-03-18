import { combineLatest, of } from "rxjs";
import { auditTime, switchMap, map } from "rxjs/operators";
import type { Model } from "applesauce-core/event-store";
import {
  PATCH_KIND,
  PR_KIND,
  LABEL_KIND,
  DELETION_KIND,
  STATUS_KINDS,
  COMMENT_KIND,
  pubkeyFromCoordinate,
  buildResolvedPRs,
  type ResolvedPR,
} from "@/lib/nip34";
import { hasNameValueTag, type Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";

/** All essential kinds fetched alongside PRs/patches. */
const ESSENTIALS_KINDS = [...STATUS_KINDS, LABEL_KIND, DELETION_KIND] as const;

/**
 * PRListModel — subscribes to patches (kind:1617) and PRs (kind:1618) and
 * their essentials, comment, and zap events in the store and emits a
 * fully-resolved list of ResolvedPR objects.
 *
 * Structurally identical to IssueListModel but:
 * - Queries kinds [1617, 1618] instead of [1621]
 * - Filters patches to root-only (t:root tag) in the final build step
 * - Passes mergeStatusRequiresMaintainer=true via buildResolvedPRs
 *
 * Cache key: the sorted, comma-joined coordinate string (same as IssueListModel).
 *
 * @param coordsCacheKey - Sorted, comma-joined coordinate string (cache key)
 */
export function PRListModel(coordsCacheKey: string): Model<ResolvedPR[]> {
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
        const events = (prEvents as NostrEvent[]).filter(
          (ev) =>
            ev.kind === PR_KIND ||
            (ev.kind === PATCH_KIND && hasNameValueTag(ev, "t", "root")),
        );
        if (events.length === 0) return of([] as ResolvedPR[]);

        const ids = events.map((e) => e.id);

        const essentials$ = store.timeline([
          { kinds: [...ESSENTIALS_KINDS], "#e": ids } as Filter,
        ]);
        const comments$ = store.timeline([
          { kinds: [COMMENT_KIND], "#E": ids } as Filter,
        ]);
        const zaps$ = store.timeline([{ kinds: [9735], "#e": ids } as Filter]);

        return combineLatest([essentials$, comments$, zaps$]).pipe(
          map(([essentialEvents, commentEvents, zapEvents]) =>
            buildResolvedPRs(
              events,
              essentialEvents as NostrEvent[],
              commentEvents as NostrEvent[],
              zapEvents as NostrEvent[],
              maintainerSet,
            ),
          ),
        );
      }),
    );
  };
}
