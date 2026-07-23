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
import {
  auditTime,
  distinctUntilChanged,
  map,
  switchMap,
} from "rxjs/operators";
import type { Model } from "applesauce-core/event-store";
import type { NostrEvent } from "nostr-tools";
import { getZapEventPointer } from "applesauce-common/helpers";
import { REPO_KIND } from "@/lib/nip34";
import {
  buildThreadEventMap,
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
 * @param pubkey           - The user's pubkey
 * @param readState$       - Observable of the current read/archived state
 * @param repoCoords$      - Observable of the user's own repo coordinates
 * @param nonGitEventIds$  - Observable of event IDs confirmed as non-git by
 *   the async resolver. Populated by the zap-receipt watcher in
 *   notificationStore. Events in this set are excluded from thread grouping.
 *
 * Cache key: pubkey only (via getKey). The BehaviorSubject references are
 * stable for the lifetime of the store entry.
 */
export function NotificationModel(
  pubkey: string,
  readState$: Observable<NotificationReadState>,
  repoCoords$: Observable<string[]>,
  nonGitEventIds$: Observable<Set<string>>,
): Model<NotificationModelOutput> {
  return (store) => {
    const threadFilters = buildNotificationFilters(pubkey);

    // Thread events — static filters (includes zap receipts on thread items)
    const threadEvents$ = store.timeline(threadFilters);

    // Zap receipts identify their target event rather than its thread root.
    // Watch targets that do not independently match notification filters.
    const zappedTargetEvents$ = threadEvents$.pipe(
      map((events) =>
        [
          ...new Set(
            (events as NostrEvent[])
              .filter((event) => event.kind === ZAP_RECEIPT_KIND)
              .flatMap((event) => {
                const target = getZapEventPointer(event);
                return target ? [target.id] : [];
              }),
          ),
        ].sort(),
      ),
      distinctUntilChanged(
        (previous, current) =>
          previous.length === current.length &&
          previous.every((id, index) => id === current[index]),
      ),
      switchMap((ids) =>
        ids.length > 0
          ? (store.timeline([{ ids }]) as unknown as Observable<NostrEvent[]>)
          : of([] as NostrEvent[]),
      ),
    );

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
      zappedTargetEvents$,
      readState$,
      repoStarEvents$,
      repoZapEvents$,
      repoCoords$,
      nonGitEventIds$,
    ]).pipe(
      // Collapse rapid emissions (e.g. many events arriving at once)
      auditTime(100),

      map(
        ([
          threadEventsRaw,
          zappedTargetEvents,
          readState,
          starEventsRaw,
          zapEventsRaw,
          coords,
          nonGitEventIds,
        ]) => {
          const allThreadEvents = threadEventsRaw as NostrEvent[];
          const targetEvents = zappedTargetEvents as NostrEvent[];
          const allStarEvents = starEventsRaw as NostrEvent[];
          const allRepoZapEvents = zapEventsRaw as NostrEvent[];

          const threadEventsById = buildThreadEventMap(
            [...allThreadEvents, ...targetEvents],
            (id) => (store.getByFilters([{ ids: [id] }]) as NostrEvent[])[0],
          );

          // Separate thread zaps from repo zaps already handled above.
          // Repo zap receipts are those with k=REPO_KIND OR with an #a tag
          // (addressable-event zap). Thread items are regular events so their
          // receipts have #e but never #a.
          const threadZapEvents = allThreadEvents.filter(
            (ev) =>
              ev.kind === ZAP_RECEIPT_KIND &&
              ev.tags.find(([t]) => t === "k")?.[1] !== String(REPO_KIND) &&
              !ev.tags.some(([t]) => t === "a"),
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
            threadEventsById,
            nonGitEventIds,
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
