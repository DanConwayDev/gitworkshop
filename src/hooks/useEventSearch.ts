/**
 * useEventSearch — React hook wrapping searchForEvent.
 *
 * Subscribes to the searchForEvent observable via use$() and reduces the
 * signal stream into a state object suitable for UI rendering.
 *
 * The hook also pipes found events into the EventStore so downstream
 * models/casts react automatically.
 *
 * Usage:
 *   const search = useEventSearch(target, groups);
 *   // search.found — event arrived
 *   // search.deleted — kind:5 deletion found
 *   // search.vanished — kind:62 vanish request found
 *   // search.concludedNotFound — all groups exhausted, nothing found
 *   // search.relayStatuses — per-relay status grouped by label
 *   // search.activeGroup — label of the currently searching group (or null)
 *   // search.event — the found NostrEvent (if any)
 */

import { useMemo, useRef } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { pool } from "@/services/nostr";
import {
  searchForEvent,
  type SearchTarget,
  type RelayGroupSpec,
  type SearchSignal,
  type RelaySearchStatus,
  type SearchForEventOptions,
} from "@/lib/searchForEvent";
import type { NostrEvent } from "nostr-tools";
import { Observable } from "rxjs";
import { scan, tap, shareReplay } from "rxjs/operators";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RelayStatusEntry {
  status: RelaySearchStatus;
  group: string;
}

export interface EventSearchState {
  /** Per-relay status map: relay URL → { status, group label } */
  relayStatuses: Record<string, RelayStatusEntry>;
  /** The label of the group currently being searched (null if done) */
  activeGroup: string | null;
  /** True once any relay has found the event */
  found: boolean;
  /** The found event, if any */
  event: NostrEvent | undefined;
  /** True if a kind:5 deletion event was found targeting this event */
  deleted: boolean;
  /** The kind:5 deletion event, if found */
  deletionEvent: NostrEvent | undefined;
  /** True if a kind:62 vanish request was found for the author */
  vanished: boolean;
  /** The kind:62 vanish event, if found */
  vanishEvent: NostrEvent | undefined;
  /** True once all groups are exhausted and deletion/vanish check is complete */
  concludedNotFound: boolean;
  /**
   * True once the immediate-tier settle signal fires (first EOSE + debounce,
   * or deferTimeout hard deadline). At this point the deletion check is
   * running and deferred groups have activated. Safe to show "Search more
   * relays" button from here.
   */
  settled: boolean;
}

const INITIAL_STATE: EventSearchState = {
  relayStatuses: {},
  activeGroup: null,
  found: false,
  event: undefined,
  deleted: false,
  deletionEvent: undefined,
  vanished: false,
  vanishEvent: undefined,
  concludedNotFound: false,
  settled: false,
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reduceSignal(
  state: EventSearchState,
  signal: SearchSignal,
): EventSearchState {
  switch (signal.type) {
    case "relay-connecting":
      return {
        ...state,
        activeGroup: signal.group,
        relayStatuses: {
          ...state.relayStatuses,
          [signal.relay]: { status: "connecting", group: signal.group },
        },
      };

    case "relay-searching":
      return {
        ...state,
        activeGroup: signal.group,
        relayStatuses: {
          ...state.relayStatuses,
          [signal.relay]: { status: "searching", group: signal.group },
        },
      };

    case "relay-eose":
      return {
        ...state,
        relayStatuses: {
          ...state.relayStatuses,
          [signal.relay]: { status: "eose", group: signal.group },
        },
      };

    case "relay-found":
      return {
        ...state,
        found: true,
        event: signal.event,
        relayStatuses: {
          ...state.relayStatuses,
          [signal.relay]: { status: "found", group: signal.group },
        },
      };

    case "relay-error":
      return {
        ...state,
        relayStatuses: {
          ...state.relayStatuses,
          [signal.relay]: { status: signal.kind, group: signal.group },
        },
      };

    case "group-exhausted":
      return {
        ...state,
        // activeGroup advances to the next group (or null if this was the last)
        // The next relay-connecting signal will set it; for now keep current
        activeGroup:
          state.activeGroup === signal.group ? null : state.activeGroup,
      };

    case "settled":
      return { ...state, settled: true };

    case "deletion-found":
      return {
        ...state,
        deleted: true,
        deletionEvent: signal.event,
      };

    case "vanish-found":
      return {
        ...state,
        vanished: true,
        vanishEvent: signal.event,
      };

    case "concluded-not-found":
      return {
        ...state,
        concludedNotFound: true,
        activeGroup: null,
      };
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Search for a specific Nostr event across ordered relay groups.
 *
 * Returns undefined while the search hasn't started (target is undefined),
 * or an EventSearchState that updates reactively as signals arrive.
 *
 * Found events are automatically added to the global EventStore.
 *
 * @param target - What to search for, or undefined to skip
 * @param groups - Ordered relay groups (tried sequentially)
 * @param opts   - Options passed to searchForEvent
 */
export function useEventSearch(
  target: SearchTarget | undefined,
  groups: RelayGroupSpec[],
  opts?: SearchForEventOptions,
): EventSearchState | undefined {
  const store = useEventStore();

  // Stable key for the target so use$ re-subscribes when it changes
  const targetKey = useMemo(() => {
    if (!target) return "";
    switch (target.type) {
      case "event":
        return `event:${target.id}:${target.authorPubkey ?? ""}`;
      case "address":
        return `address:${target.kind}:${target.pubkey}:${target.dTag}`;
      case "profile":
        return `profile:${target.pubkey}`;
    }
  }, [target]);

  // Stable key for groups so use$ re-subscribes when the group list changes
  // (but NOT when relay URLs within a group change — that's handled reactively
  // by the factory via relays$)
  const groupsKey = useMemo(
    () => groups.map((g) => g.label).join("|"),
    [groups],
  );

  // Keep a stable reference to groups array to avoid re-subscribing when
  // the array identity changes but the content is the same
  const groupsRef = useRef(groups);
  if (groupsKey !== groupsRef.current.map((g) => g.label).join("|")) {
    groupsRef.current = groups;
  }

  return use$(() => {
    if (!target) return undefined;

    return searchForEvent(pool, target, groupsRef.current, opts).pipe(
      // Side effect: add found events to the EventStore
      tap((signal) => {
        if (signal.type === "relay-found") {
          store.add(signal.event);
        }
      }),
      // Reduce signal stream into cumulative state
      scan(reduceSignal, INITIAL_STATE),
      // Share so multiple subscribers don't create multiple searches
      shareReplay(1),
    ) as unknown as Observable<EventSearchState>;
  }, [targetKey, groupsKey, store]);
}

// Re-export types for convenience
export type {
  SearchTarget,
  RelayGroupSpec,
  SearchSignal,
  RelaySearchStatus,
  SearchForEventOptions,
} from "@/lib/searchForEvent";
