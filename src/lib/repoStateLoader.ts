/**
 * repoStateLoader
 *
 * Fetches kind:30618 repository state events from a relay group, querying
 * each relay individually so that every relay's version of the addressable
 * event is observed before the EventStore deduplicates them.
 *
 * Why per-relay queries matter:
 *   Grasp servers only serve the state event that matches the git data they
 *   hold. A server that is behind the canonical state will serve an older
 *   version of the event. By querying each relay separately we can collect
 *   all versions and later determine whether a behind-server has a previously
 *   signed state (out of scope for this loader — it just delivers the raw
 *   events).
 *
 * Reactive relay list:
 *   The loader subscribes to relays$ from the RelayGroup and reacts to new
 *   relays being added. Each newly discovered relay gets its own subscription.
 *   Existing relay subscriptions are never touched — only new relays trigger
 *   new work.
 *
 * Settle signal:
 *   A single settled$ Subject is shared across the entire observable lifetime.
 *   Each relay pushes to it on EOSE (or error/close). makeSettleSignal()
 *   debounces those pushes so that a burst of relays finishing close together
 *   (including newly added ones) produces a single "EOSE" emission. This
 *   matches the settle semantics of createPaginatedTagValueLoader exactly.
 *
 * EventStore + relay provenance:
 *   The Relay class applies markFromRelay() internally on every req, so each
 *   event is already stamped with its source relay URL before it reaches this
 *   loader. mapEventsToStore() then writes those stamped events into the store,
 *   meaning getSeenRelays(event) works on any event retrieved from the store.
 *   Callers can build a per-relay state registry purely from store.timeline()
 *   without any side-channel state.
 */

import type { RelayGroup, IRelay, RelayPool } from "applesauce-relay";
import type { IEventStore } from "applesauce-core/event-store";
import { mapEventsToStore } from "applesauce-core";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import { Observable, Subject } from "rxjs";
import { distinctUntilChanged, map } from "rxjs/operators";
import { makeSettleSignal, DEFAULT_SETTLE_TIME } from "./settleSignal";

export type RepoStateResponse = NostrEvent | "EOSE";

export interface RepoStateLoaderOptions {
  /**
   * Debounce window in ms before emitting "EOSE" after the last relay
   * finishes (default 200 — matches createPaginatedTagValueLoader).
   */
  settleTime?: number;
}

/**
 * Open a single-relay subscription for kind:30618 state events.
 * Pushes to settled$ on EOSE, error, or clean close so the settle signal
 * is never blocked by a misbehaving relay.
 *
 * The Relay class applies markFromRelay() internally, so emitted events are
 * already stamped with the relay URL before reaching this function.
 *
 * Returns an Observable<NostrEvent> that completes when the relay closes
 * the subscription (normal for addressable-event fetches).
 */
function queryRelay(
  pool: RelayPool,
  relayUrl: string,
  stateFilter: Filter,
  settled$: Subject<void>,
): Observable<NostrEvent> {
  return new Observable<NostrEvent>((subscriber) => {
    const sub = pool
      .subscription([relayUrl], [stateFilter], { reconnect: false })
      .subscribe({
        next: (msg) => {
          if (msg === "EOSE") {
            settled$.next();
          } else {
            subscriber.next(msg as NostrEvent);
          }
        },
        error: () => {
          settled$.next();
          subscriber.complete();
        },
        complete: () => {
          // Some relays close cleanly after EOSE without a separate EOSE
          // message — treat completion as settled too.
          settled$.next();
          subscriber.complete();
        },
      });

    return () => sub.unsubscribe();
  });
}

/**
 * Fetch all versions of the kind:30618 repository state event from every
 * relay in the group, writing events into the EventStore as they arrive.
 *
 * The observable reacts to new relays being added to the group: each newly
 * discovered relay gets its own subscription without disturbing existing ones.
 *
 * The Relay class applies markFromRelay() internally, so events arrive
 * already stamped with their source relay URL. getSeenRelays(event) is
 * therefore available on any event retrieved from the store later.
 *
 * Emits NostrEvent | "EOSE". "EOSE" fires once all relays that have
 * responded so far have settled (debounced by settleTime ms). If new relays
 * are added later they push to the same settled$ Subject, resetting the
 * debounce window so "EOSE" reflects the full current relay set.
 *
 * Does not complete — callers should unsubscribe when done (use$ handles this).
 *
 * @param pool           - Global RelayPool
 * @param repoRelayGroup - Relay group from useResolvedRepository
 * @param dTag           - Repository d-tag identifier
 * @param maintainerSet  - All maintainer pubkeys
 * @param eventStore     - EventStore to write events into
 * @param opts           - Optional settleTime override
 */
export function loadRepoStateFromRelays(
  pool: RelayPool,
  repoRelayGroup: RelayGroup,
  dTag: string,
  maintainerSet: string[],
  eventStore: IEventStore,
  opts: RepoStateLoaderOptions = {},
): Observable<RepoStateResponse> {
  const settleMs = opts.settleTime ?? DEFAULT_SETTLE_TIME;

  return new Observable<RepoStateResponse>((subscriber) => {
    const stateFilter: Filter = {
      kinds: [30618],
      authors: maintainerSet,
      "#d": [dTag],
    } as Filter;

    // Single settle signal shared across all relay subscriptions for this
    // observable lifetime. New relays push to the same settled$ so their
    // EOSE resets the debounce window rather than being lost.
    const { settled$, eose$ } = makeSettleSignal(settleMs);

    // Track relay URLs that already have a subscription so new relays don't
    // re-trigger existing ones.
    const knownRelayUrls = new Set<string>();

    // Merge stream for all per-relay event observables. We use a Subject so
    // we can add new relay streams dynamically as the group grows.
    const relayEvents$ = new Subject<NostrEvent>();

    // Pipe all relay events through the EventStore and forward to subscriber.
    // Events are already stamped with their source relay by the Relay class
    // internally, so getSeenRelays() works on stored events.
    const storeSub = relayEvents$.pipe(mapEventsToStore(eventStore)).subscribe({
      next: (event) => subscriber.next(event as NostrEvent),
      error: (err) => subscriber.error(err),
    });

    // Forward EOSE sentinel to subscriber.
    const eoseSub = eose$.subscribe({
      next: () => subscriber.next("EOSE"),
      error: (err) => subscriber.error(err),
    });

    // Subscribe to RelayGroup relay list changes. relays$ is protected in TS
    // but public at runtime — cast to access it so we can react to new relays
    // being added without polling.
    const relays$ = (
      repoRelayGroup as unknown as { relays$: Observable<IRelay[]> }
    ).relays$;

    const relaySub = relays$
      .pipe(
        map((relays) => relays.map((r) => r.url)),
        distinctUntilChanged(
          (a, b) =>
            a.length === b.length && a.every((url) => knownRelayUrls.has(url)),
        ),
      )
      .subscribe({
        next: (currentUrls) => {
          const newUrls = currentUrls.filter((url) => !knownRelayUrls.has(url));

          if (newUrls.length === 0) {
            // relays$ emitted but no new relays — if we have never seen any
            // relays at all (group started empty), settle immediately so the
            // consumer doesn't wait forever.
            if (knownRelayUrls.size === 0) settled$.next();
            return;
          }

          for (const url of newUrls) {
            knownRelayUrls.add(url);
            // Each new relay gets its own subscription. Events flow into
            // relayEvents$ which is already piped through the EventStore.
            queryRelay(pool, url, stateFilter, settled$).subscribe({
              next: (event) => relayEvents$.next(event),
              error: () => {
                /* queryRelay handles errors internally */
              },
            });
          }
        },
        error: (err) => subscriber.error(err),
      });

    return () => {
      relaySub.unsubscribe();
      storeSub.unsubscribe();
      eoseSub.unsubscribe();
      relayEvents$.complete();
    };
  });
}
