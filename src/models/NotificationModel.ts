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
  groupNotifications,
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
 * @param pubkey     - The user's pubkey
 * @param readState$ - Observable of the current read/archived state
 */
export function NotificationModel(
  pubkey: string,
  readState$: Observable<NotificationReadState>,
): Model<NotificationModelOutput> {
  return (store) => {
    const filters = buildNotificationFilters(pubkey);

    // Subscribe to all notification events in the store.
    // We use separate timelines for each filter and merge the results
    // because the store.timeline() only accepts a single filter array.
    const events$ = store.timeline(filters);

    return combineLatest([events$, readState$]).pipe(
      // Collapse rapid emissions (e.g. many events arriving at once)
      auditTime(100),

      map(([events, readState]) => {
        const allEvents = events as NostrEvent[];
        const items = groupNotifications(allEvents, readState, pubkey);

        // Unread count = number of unread items that are NOT archived
        const unreadCount = items.filter(
          (item) => item.unread && !item.archived,
        ).length;

        return { items, unreadCount };
      }),
    );
  };
}
