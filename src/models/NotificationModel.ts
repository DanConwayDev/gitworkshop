/**
 * NotificationModel — reactive model that groups notification events by
 * root issue/PR/patch and computes read/archived status.
 *
 * This model does NOT fetch from relays — pair it with relay subscriptions
 * in useNotifications that populate the store first.
 *
 * The read state is injected as an external Observable<NotificationReadState>
 * (backed by a BehaviorSubject in the hook layer) so the model can react to
 * both store changes and read-state changes.
 *
 * Cache key: the user's pubkey (one model per logged-in user).
 */

import { combineLatest, of, type Observable } from "rxjs";
import { auditTime, map, switchMap } from "rxjs/operators";
import type { Model } from "applesauce-core/event-store";
import type { NostrEvent } from "nostr-tools";
import { getCommentRootPointer } from "applesauce-common/helpers";
import { REPO_KIND, COMMENT_KIND } from "@/lib/nip34";
import {
  buildNotificationFilters,
  buildRepoStarFilter,
  buildRepoZapFilter,
  groupNotifications,
  groupSocialNotifications,
  groupRepoZapNotifications,
  ZAP_RECEIPT_KIND,
  type NotificationItem,
  type NotificationReadState,
} from "@/lib/notifications";

export interface NotificationModelOutput {
  /** Grouped notification items, sorted by latest activity (newest first) */
  items: NotificationItem[];
  /** Number of unread items in the inbox (not archived) */
  unreadCount: number;
}

/**
 * Create a NotificationModel that subscribes to notification events in the
 * store and combines them with the read state to produce grouped items.
 *
 * @param pubkey      - The user's pubkey
 * @param readState$  - Observable of the current read/archived state
 * @param repoCoords$ - Observable of the user's own repo coordinates
 *
 * Cache key: pubkey only (via getKey). The BehaviorSubject references are
 * stable for the lifetime of the store entry.
 */
export function NotificationModel(
  pubkey: string,
  readState$: Observable<NotificationReadState>,
  repoCoords$: Observable<string[]>,
): Model<NotificationModelOutput> {
  return (store) => {
    const threadFilters = buildNotificationFilters(pubkey);

    // Thread events — static filters (includes zap receipts on thread items)
    const threadEvents$ = store.timeline(threadFilters);

    // Repo star events — reactive: re-subscribes to the store timeline
    // whenever the user's repo list changes, so new stars are picked up
    // without needing an unrelated re-emit to trigger a snapshot.
    // When there are no repos, of([]) emits once and completes — this is
    // safe because combineLatest keeps using the last value from completed
    // sources while the other sources continue to emit.
    const repoStarEvents$ = repoCoords$.pipe(
      switchMap((coords) => {
        if (coords.length === 0) return of([] as NostrEvent[]);
        return store.timeline([
          buildRepoStarFilter(coords),
        ]) as unknown as Observable<NostrEvent[]>;
      }),
    );

    // Repo zap events — same pattern as stars but for kind:9735 receipts
    // targeting our repo announcements via #a coord.
    const repoZapEvents$ = repoCoords$.pipe(
      switchMap((coords) => {
        if (coords.length === 0) return of([] as NostrEvent[]);
        return store.timeline([
          buildRepoZapFilter(coords),
        ]) as unknown as Observable<NostrEvent[]>;
      }),
    );

    return combineLatest([
      threadEvents$,
      readState$,
      repoStarEvents$,
      repoZapEvents$,
      repoCoords$,
    ]).pipe(
      // Collapse rapid emissions (e.g. many events arriving at once)
      auditTime(100),

      map(
        ([threadEventsRaw, readState, starEventsRaw, zapEventsRaw, coords]) => {
          const allThreadEvents = threadEventsRaw as NostrEvent[];
          const allStarEvents = starEventsRaw as NostrEvent[];
          const allRepoZapEvents = zapEventsRaw as NostrEvent[];

          // Build a commentId→rootId resolution map from the thread events
          // already in the store. This lets getNotificationRootId correctly
          // group zap receipts on NIP-22 comments (kind:1111) under their
          // parent thread rather than as orphaned items.
          const commentRootMap = new Map<string, string>();
          for (const ev of allThreadEvents) {
            if (ev.kind === COMMENT_KIND) {
              const rootPointer = getCommentRootPointer(ev);
              if (rootPointer && "id" in rootPointer && rootPointer.id) {
                commentRootMap.set(ev.id, rootPointer.id);
              }
            }
          }

          // Separate thread zaps from repo zaps already handled above.
          // Thread zap receipts are those with #k NOT equal to REPO_KIND.
          const threadZapEvents = allThreadEvents.filter(
            (ev) =>
              ev.kind === ZAP_RECEIPT_KIND &&
              ev.tags.find(([t]) => t === "k")?.[1] !== String(REPO_KIND),
          );

          // Non-zap thread events (comments, issues, PRs, etc.)
          const nonZapThreadEvents = allThreadEvents.filter(
            (ev) => ev.kind !== ZAP_RECEIPT_KIND,
          );

          // groupNotifications receives both regular thread events and thread
          // zap receipts so they contribute to the same thread group.
          const threadItems = groupNotifications(
            [...nonZapThreadEvents, ...threadZapEvents],
            readState,
            pubkey,
            commentRootMap,
          );
          const socialItems = groupSocialNotifications(
            allStarEvents,
            coords,
            readState,
            pubkey,
          );
          const repoZapItems = groupRepoZapNotifications(
            allRepoZapEvents,
            coords,
            readState,
            pubkey,
          );

          // Merge and sort all items by latestActivity, newest first
          const allItems: NotificationItem[] = [
            ...threadItems,
            ...socialItems,
            ...repoZapItems,
          ];
          allItems.sort((a, b) => b.latestActivity - a.latestActivity);

          // Unread count = number of unread items that are NOT archived
          const unreadCount = allItems.filter(
            (item) => item.unread && !item.archived,
          ).length;

          return { items: allItems, unreadCount };
        },
      ),
    );
  };
}

/**
 * Cache key: pubkey only. The readState$ and repoCoords$ arguments are
 * intentionally excluded so the model instance is reused across acquire/release
 * cycles for the same pubkey.
 */
NotificationModel.getKey = (pubkey: string) => pubkey;
