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
 * Deduplication and relay provenance:
 *   resilientSubscription does NOT deduplicate events — it emits every event
 *   from every relay. The Relay class stamps each event with addSeenRelay
 *   before it reaches this loader, so older versions from behind-servers
 *   still carry their source relay URL when they hit mapEventsToStore().
 *   The EventStore deduplicates by created_at (keeps newest) but the relay
 *   provenance is already recorded, so getSeenRelays(event) works correctly
 *   on any event retrieved from the store later.
 *
 * Reactive relay list:
 *   resilientSubscription's Observable<string[]> overload diffs the relay set
 *   on each emission: new relays get their own per-relay stream, removed relays
 *   are unsubscribed. Existing relay streams are never disturbed.
 *
 * Reconnect:
 *   resilientSubscription keeps each per-relay stream alive with smart
 *   reconnect (since: lastReceivedAt - gapFillBuffer) and foreground resume
 *   gap-fill, so live state updates are received reliably.
 *
 * EventStore + relay provenance:
 *   The Relay class applies `addSeenRelay` internally on every req, so each
 *   event is already stamped with its source relay URL before it reaches this
 *   loader. mapEventsToStore() then writes those stamped events into the store,
 *   meaning getSeenRelays(event) works on any event retrieved from the store.
 *   Callers can build a per-relay state registry purely from store.timeline()
 *   without any side-channel state.
 */

import type { RelayPool } from "applesauce-relay";
import { onlyEvents } from "applesauce-relay";
import type { IEventStore } from "applesauce-core/event-store";
import { mapEventsToStore } from "applesauce-core";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import { EMPTY } from "rxjs";
import { catchError } from "rxjs/operators";
import { resilientSubscription } from "./resilientSubscription";
import { DEFAULT_SETTLE_TIME } from "./settleSignal";

export type RepoStateResponse = NostrEvent | "EOSE";

export interface RepoStateLoaderOptions {
  /**
   * Debounce window in ms before emitting "EOSE" after the last relay
   * finishes (default 200 — matches createPaginatedTagValueLoader).
   */
  settleTime?: number;
}

/**
 * Fetch all versions of the kind:30618 repository state event from every
 * relay in the provided relay list, writing events into the EventStore as
 * they arrive.
 *
 * Uses resilientSubscription with the reactive relay-list overload so that:
 *   - Each relay gets its own per-relay stream with smart reconnect and
 *     foreground resume gap-fill, keeping the subscription alive for live
 *     state updates.
 *   - New relays added to relays$ are picked up automatically; removed relays
 *     are unsubscribed without disturbing existing streams.
 *   - Events are NOT deduplicated by resilientSubscription — every relay's
 *     version flows through to mapEventsToStore(), which stamps relay
 *     provenance before the EventStore deduplicates by created_at.
 *
 * Emits NostrEvent | "EOSE". "EOSE" fires once all current relays have
 * settled (debounced by settleTime ms).
 *
 * Does not complete — callers should unsubscribe when done (use$ handles this).
 *
 * @param pool      - Global RelayPool
 * @param relays$   - Observable<string[]> of relay URLs; emits additively as
 *                    new relays are discovered (e.g. from relayGroupUrls$())
 * @param dTag           - Repository d-tag identifier
 * @param maintainerSet  - All maintainer pubkeys
 * @param eventStore     - EventStore to write events into
 * @param opts           - Optional settleTime override
 */
export function loadRepoStateFromRelays(
  pool: RelayPool,
  relays$: Observable<string[]>,
  dTag: string,
  maintainerSet: string[],
  eventStore: IEventStore,
  opts: RepoStateLoaderOptions = {},
): Observable<RepoStateResponse> {
  const stateFilter: Filter = {
    kinds: [30618],
    authors: maintainerSet,
    "#d": [dTag],
  } as Filter;

  return resilientSubscription(pool, relays$, [stateFilter], {
    settleTime: opts.settleTime ?? DEFAULT_SETTLE_TIME,
    // Keep subscriptions alive for live state updates — reconnect and
    // gap-fill are the whole point of using resilientSubscription here.
    reconnect: true,
    gapFill: true,
    // No pagination — kind:30618 is addressable/replaceable; there is at
    // most one current version per pubkey+d-tag combination per relay.
    paginate: false,
  }).pipe(
    onlyEvents(),
    mapEventsToStore(eventStore),
    catchError(() => EMPTY),
  ) as Observable<RepoStateResponse>;
}
