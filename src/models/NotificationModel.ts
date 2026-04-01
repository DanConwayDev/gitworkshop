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
import {
  buildNotificationFilters,
  buildRepoStarFilter,
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

    // Thread events — static filters
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

    return combineLatest([
      threadEvents$,
      readState$,
      repoStarEvents$,
      repoCoords$,
    ]).pipe(
      // Collapse rapid emissions (e.g. many events arriving at once)
      auditTime(100),

      map(([threadEventsRaw, readState, starEventsRaw, coords]) => {
        const allThreadEvents = threadEventsRaw as NostrEvent[];
        const allStarEvents = starEventsRaw as NostrEvent[];

        const threadItems = groupNotifications(
          allThreadEvents,
          readState,
          pubkey,
        );
        const socialItems = groupSocialNotifications(
          allStarEvents,
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
