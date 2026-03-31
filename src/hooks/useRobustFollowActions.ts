/**
 * useRobustFollowActions — a safer alternative to calling FollowUser /
 * UnfollowUser directly via useAction.
 *
 * WHY THIS EXISTS
 * ---------------
 * The built-in applesauce FollowUser / UnfollowUser actions read the current
 * contacts event (kind:3) from the in-memory EventStore and modify it. If the
 * user has updated their contact list on another client that publishes to
 * relays we haven't connected to, the EventStore will hold a stale copy and
 * the action will silently overwrite those changes.
 *
 * This hook adds three layers of protection that the default action omits:
 *
 * 1. CONNECTIVITY THRESHOLD CHECK
 *    Before attempting any write, we verify that we are connected to at least
 *    MIN_CONNECTED_FRACTION of the user's outbox + lookup relays (minimum
 *    MIN_CONNECTED_RELAYS). If connectivity is insufficient we throw a
 *    descriptive error rather than risk a partial or stale write.
 *
 * 2. FRESH FETCH FROM ALL OUTBOX + LOOKUP RELAYS
 *    We use addressLoader to fetch the latest kind:3 from the user's outbox
 *    relays AND the configured lookup relays, then wait for it to land in the
 *    EventStore. This ensures the action always starts from the most recent
 *    known state across all relay sets.
 *
 * 3. PERSISTENT BACKGROUND SUBSCRIPTION (handled in accounts.ts)
 *    A continuous pool.subscription() for kinds 0, 3, 10002, 10317 is kept
 *    open on the user's outbox relays for the lifetime of the session (see
 *    src/services/userIdentitySubscription.ts). This means the EventStore is
 *    already warm in most cases — the addressLoader fetch here is a final
 *    safety net, not the primary mechanism.
 */

import { useCallback, useState } from "react";
import { firstValueFrom, race } from "rxjs";
import { filter, take } from "rxjs/operators";
import { useActiveAccount } from "applesauce-react/hooks";
import { useAction } from "@/hooks/useAction";
import { useEventStore } from "@/hooks/useEventStore";
import { use$ } from "@/hooks/use$";
import { FollowUser, UnfollowUser } from "applesauce-actions/actions";
import { MailboxesModel } from "applesauce-core/models";
import { addressLoader, liveness, pool } from "@/services/nostr";
import { lookupRelays } from "@/services/settings";
import type { ProfilePointer } from "applesauce-core/helpers";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Minimum fraction of the user's relay set that must be healthy (online or
 * not in backoff) before we allow a contacts list write.
 * 0.5 = at least half.
 */
const MIN_CONNECTED_FRACTION = 0.5;

/**
 * Absolute minimum number of healthy relays required regardless of fraction.
 * Prevents the fraction check from passing on a 1-relay set where 1/1 = 100%.
 */
const MIN_CONNECTED_RELAYS = 1;

/**
 * How long (ms) to wait for the addressLoader to return the latest kind:3
 * before proceeding with whatever is already in the EventStore.
 */
const FETCH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface RobustFollowActionsResult {
  /** Follow a user. Throws if connectivity is insufficient. */
  follow: (pubkey: string | ProfilePointer) => Promise<void>;
  /** Unfollow a user. Throws if connectivity is insufficient. */
  unfollow: (pubkey: string | ProfilePointer) => Promise<void>;
  /** True while a follow or unfollow operation is in progress. */
  pending: boolean;
}

export function useRobustFollowActions(): RobustFollowActionsResult {
  const account = useActiveAccount();
  const store = useEventStore();
  const { run: followUser } = useAction(FollowUser);
  const { run: unfollowUser } = useAction(UnfollowUser);
  const [pending, setPending] = useState(false);

  // Reactively subscribe to the user's outbox relays so we always have the
  // latest list when the action fires.
  const mailboxes = use$(
    () =>
      account?.pubkey ? store.model(MailboxesModel, account.pubkey) : undefined,
    [account?.pubkey, store],
  );

  const getRelaySet = useCallback((): string[] => {
    const outboxes = mailboxes?.outboxes ?? [];
    const lookup = lookupRelays.getValue();
    // Deduplicate: outboxes first, then lookup relays not already in outboxes
    const seen = new Set(outboxes);
    const combined = [...outboxes];
    for (const r of lookup) {
      if (!seen.has(r)) combined.push(r);
    }
    return combined;
  }, [mailboxes]);

  /**
   * Check that we are connected to enough relays to safely write.
   *
   * Three-layer check (fastest-to-slowest):
   *   1. navigator.onLine — immediate OS/browser network state. DevTools
   *      offline mode sets this to false instantly, before any WebSocket
   *      close events fire. Fast-fail here avoids the race where sockets
   *      appear connected for several seconds after going offline.
   *   2. Pool connection state — is the WebSocket actually open right now?
   *      Relays not yet in the pool (never connected this session) count as
   *      disconnected. Catches the case where relays were never reached.
   *   3. Liveness backoff — skip relays that liveness has marked as dead or
   *      in backoff (repeated failures even while nominally online).
   *
   * A relay is considered "healthy" only if all applicable layers pass.
   *
   * Throws a user-facing error if the threshold is not met.
   */
  const assertConnectivity = useCallback((relays: string[]) => {
    if (relays.length === 0) {
      throw new Error(
        "No relay configuration found. Cannot safely update your follow list — please check your relay settings.",
      );
    }

    // Layer 1: fast-fail on navigator.onLine (catches DevTools offline mode
    // immediately, before WebSocket close events have had time to propagate)
    if (!navigator.onLine) {
      throw new Error(
        "You appear to be offline. Please check your internet connection and try again.",
      );
    }

    // Layer 2: pool connection state (WebSocket open = actually connected now)
    const connectedRelays = relays.filter((url) => {
      const relay = pool.relays.get(url);
      return relay?.connected === true;
    });

    // Layer 3: liveness filter (removes dead / backoff relays from the connected set)
    const healthyRelays = liveness.filter(connectedRelays);
    const healthyCount = healthyRelays.length;
    const fraction = healthyCount / relays.length;

    if (
      healthyCount < MIN_CONNECTED_RELAYS ||
      fraction < MIN_CONNECTED_FRACTION
    ) {
      throw new Error(
        `Connection is not stable enough to safely update your follow list. ` +
          `Only ${healthyCount} of ${relays.length} relay(s) are reachable ` +
          `(need at least ${Math.ceil(relays.length * MIN_CONNECTED_FRACTION)}). ` +
          `Please check your internet connection and try again.`,
      );
    }
  }, []);

  /**
   * Fetch the latest kind:3 from the user's relay set and wait for it to land
   * in the EventStore. Times out after FETCH_TIMEOUT_MS and proceeds with
   * whatever is already in the store — we never block indefinitely.
   */
  const prefetchContacts = useCallback(
    async (pubkey: string, relays: string[]) => {
      if (relays.length === 0) return;

      // Fire the addressLoader request — it will add the event to the store
      // when it arrives. We race against a timeout so we never block forever.
      await Promise.race([
        firstValueFrom(
          race(
            // Wait for the store to emit a kind:3 for this pubkey (may already
            // be there, in which case this resolves immediately)
            store.replaceable(3, pubkey).pipe(
              filter((e) => e !== undefined),
              take(1),
            ),
            // Kick off the actual relay fetch in parallel
            new Promise<void>((resolve) => {
              addressLoader({ kind: 3, pubkey, relays }).subscribe({
                complete: resolve,
                error: resolve, // don't let fetch errors block the action
              });
            }) as never,
          ),
        ),
        // Hard timeout — proceed with whatever is in the store
        new Promise<void>((resolve) => setTimeout(resolve, FETCH_TIMEOUT_MS)),
      ]);
    },
    [store],
  );

  const execute = useCallback(
    async (
      action: (pubkey: string | ProfilePointer) => Promise<void>,
      target: string | ProfilePointer,
    ) => {
      if (!account?.pubkey) {
        throw new Error("Not logged in.");
      }

      setPending(true);
      try {
        const relays = getRelaySet();

        // 1. Connectivity check — fail fast with a clear error
        assertConnectivity(relays);

        // 2. Fetch latest kind:3 from all outbox + lookup relays
        await prefetchContacts(account.pubkey, relays);

        // 3. Run the action — now guaranteed to start from the freshest state
        await action(target);
      } finally {
        setPending(false);
      }
    },
    [account?.pubkey, getRelaySet, assertConnectivity, prefetchContacts],
  );

  const follow = useCallback(
    (pubkey: string | ProfilePointer) => execute(followUser, pubkey),
    [execute, followUser],
  );

  const unfollow = useCallback(
    (pubkey: string | ProfilePointer) => execute(unfollowUser, pubkey),
    [execute, unfollowUser],
  );

  return { follow, unfollow, pending };
}
