/**
 * createTagValueSubscription
 *
 * A persistent analogue of applesauce's createTagValueLoader. Instead of
 * completing after EOSE, each batch window opens a relay.subscription() that
 * stays alive (with reconnect/resubscribe) for as long as at least one caller
 * remains subscribed.
 *
 * Batching behaviour is identical to createTagValueLoader:
 *   - Incoming pointers are buffered by time (bufferTime) and size (bufferSize)
 *   - All pointers in a window are merged into one filter per relay URL
 *   - One pool.subscription() is opened per relay per window
 *
 * Lifetime:
 *   - Each window's shared observable uses resetOnRefCountZero: true, so the
 *     relay subscription closes when the last caller from that window
 *     unsubscribes (i.e. when the component/hook that triggered it unmounts).
 *   - New item IDs arriving in later windows open additional subscriptions
 *     alongside existing ones — no churn on already-open subscriptions.
 */

import { filterDuplicateEvents } from "applesauce-core";
import { mergeRelaySets } from "applesauce-core/helpers/relays";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import {
  Observable,
  Subject,
  bufferTime,
  filter,
  merge,
  share,
  switchMap,
  take,
} from "rxjs";
import type { RelayPool, SubscriptionOptions } from "applesauce-relay";
import { onlyEvents } from "applesauce-relay";
import { mapEventsToStore } from "applesauce-core";
import type { EventStore } from "applesauce-core";

export type TagValuePointer = {
  /** The tag value to subscribe to (e.g. an event ID) */
  value: string;
  /** Relay hints for this pointer */
  relays?: string[];
};

export type TagValueSubscriptionOptions = {
  /** Time window to batch incoming pointers in ms (default 1000) */
  bufferTime?: number;
  /** Max pointers per batch window (default 200) */
  bufferSize?: number;
  /** Restrict subscription to specific kinds */
  kinds?: number[];
  /** EventStore for deduplication and storage */
  eventStore?: EventStore;
  /** Extra relays to always include */
  extraRelays?: string[];
};

export type TagValueSubscription = (
  pointer: TagValuePointer,
) => Observable<NostrEvent>;

/**
 * Build one pool.subscription() per relay URL from a batch of pointers,
 * merge them all, and return the combined observable.
 */
function buildBatchSubscription(
  pool: RelayPool,
  tagName: string,
  pointers: TagValuePointer[],
  opts: TagValueSubscriptionOptions,
  subOpts: SubscriptionOptions,
): Observable<NostrEvent> {
  const filterTag = `#${tagName}` as keyof Filter;

  // Group pointers by relay URL, merging tag values per relay
  const requestMap = pointers.reduce<Record<string, Filter>>((map, pointer) => {
    const relays = mergeRelaySets(pointer.relays, opts.extraRelays);
    for (const relay of relays) {
      if (!map[relay]) {
        const f: Filter = { [filterTag]: [pointer.value] };
        if (opts.kinds) f.kinds = opts.kinds;
        map[relay] = f;
      } else {
        (map[relay][filterTag] as string[]).push(pointer.value);
      }
    }
    return map;
  }, {});

  const perRelaySubscriptions = Object.entries(requestMap).map(
    ([relay, f]) =>
      pool
        .subscription([relay], [f], subOpts)
        .pipe(onlyEvents()) as Observable<NostrEvent>,
  );

  if (perRelaySubscriptions.length === 0) return new Observable<NostrEvent>();

  let combined: Observable<NostrEvent> = merge(...perRelaySubscriptions);

  if (opts.eventStore) {
    combined = combined.pipe(
      mapEventsToStore(opts.eventStore),
      filterDuplicateEvents(opts.eventStore),
    ) as Observable<NostrEvent>;
  }

  return combined;
}

/**
 * Creates a persistent tag-value subscription factory.
 *
 * Usage mirrors createTagValueLoader — call the returned function with a
 * pointer and subscribe to the result. The relay subscription for that
 * pointer's batch window stays open until all callers from that window
 * unsubscribe.
 */
export function createTagValueSubscription(
  pool: RelayPool,
  tagName: string,
  opts: TagValueSubscriptionOptions = {},
): TagValueSubscription {
  const bufferMs = opts.bufferTime ?? 1000;
  const bufferMax = opts.bufferSize ?? 200;

  const subOpts: SubscriptionOptions = {
    reconnect: Infinity,
    resubscribe: Infinity,
  };

  // Incoming pointer queue
  const queue = new Subject<TagValuePointer>();

  // Emits one shared observable per batch window
  const next = new Subject<Observable<NostrEvent>>();

  // Process each buffer window
  queue
    .pipe(bufferTime(bufferMs, undefined, bufferMax))
    .subscribe((pointers) => {
      if (pointers.length === 0) return;

      const upstream = buildBatchSubscription(
        pool,
        tagName,
        pointers,
        opts,
        subOpts,
      ).pipe(
        // Close relay subscription when last caller from this window leaves
        share({ resetOnRefCountZero: true }),
      );

      next.next(upstream);
    });

  return (pointer: TagValuePointer): Observable<NostrEvent> =>
    new Observable<NostrEvent>((observer) => {
      // Register this pointer into the next batch window
      queue.next(pointer);

      // Latch onto the next batch window and stay subscribed for its lifetime
      const sub = next
        .pipe(
          take(1),
          switchMap((batchObs) =>
            batchObs.pipe(
              // Only emit events that actually reference this pointer's value
              filter((event) =>
                event.tags.some(
                  (tag) => tag[0] === tagName && tag[1] === pointer.value,
                ),
              ),
            ),
          ),
        )
        .subscribe(observer);

      return () => sub.unsubscribe();
    });
}
