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

import { combineLatest, type Observable } from "rxjs";
import { auditTime, map } from "rxjs/operators";
import type { Model } from "applesauce-core/event-store";
import type { NostrEvent } from "nostr-tools";
import {
  buildNotificationFilters,
  buildAuthorFollowFilter,
  buildRepoStarFilter,
  buildRepoFollowFilter,
  groupNotifications,
  groupSocialNotifications,
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
    const authorFollowFilter = buildAuthorFollowFilter(pubkey);

    // Thread events — static filters
    const threadEvents$ = store.timeline(threadFilters);

    // Author follow events — static filter
    const authorFollowEvents$ = store.timeline([authorFollowFilter]);

    // Reactive stream of repo coords — used to re-evaluate social events
    // whenever the user's repo list changes.
    const repoStarAndFollowEvents$ = repoCoords$.pipe(map((coords) => coords));

    return combineLatest([
      threadEvents$,
      readState$,
      authorFollowEvents$,
      repoStarAndFollowEvents$,
    ]).pipe(
      // Collapse rapid emissions (e.g. many events arriving at once)
      auditTime(100),

      map(([threadEventsRaw, readState, authorFollowEventsRaw, coords]) => {
        const allThreadEvents = threadEventsRaw as NostrEvent[];
        const allAuthorFollowEvents = authorFollowEventsRaw as NostrEvent[];

        // Get repo social events synchronously from the store
        let starEvents: NostrEvent[] = [];
        let followEvents: NostrEvent[] = [];
        if (coords.length > 0) {
          starEvents = store.getByFilters([
            buildRepoStarFilter(coords),
          ]) as NostrEvent[];
          followEvents = store.getByFilters([
            buildRepoFollowFilter(coords),
          ]) as NostrEvent[];
        }

        const threadItems = groupNotifications(
          allThreadEvents,
          readState,
          pubkey,
        );
        const socialItems = groupSocialNotifications(
          allAuthorFollowEvents,
          starEvents,
          followEvents,
          coords,
          readState,
          pubkey,
        );

        // Merge and sort all items by latestActivity, newest first
        const allItems: NotificationItem[] = [...threadItems, ...socialItems];
        allItems.sort((a, b) => b.latestActivity - a.latestActivity);

        // Unread count = number of unread items that are NOT archived
        const unreadCount = allItems.filter(
          (item) => item.unread && !item.archived,
        ).length;

        return { items: allItems, unreadCount };
      }),
    );
  };
}

/**
 * Cache key: pubkey only. The readState$ and repoCoords$ arguments are
 * intentionally excluded so the model instance is reused across acquire/release
 * cycles for the same pubkey.
 */
NotificationModel.getKey = (pubkey: string) => pubkey;
