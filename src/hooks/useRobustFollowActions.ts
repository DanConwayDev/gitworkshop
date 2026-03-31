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
 *    Before attempting any write, we verify connectivity against the user's
 *    outbox relays and lookup/index relays independently. The rules are:
 *      - No outbox relays configured → error (can't trust we have latest kind:3)
 *      - 1 outbox connected → also need ≥2 lookup relays as backup
 *      - >1 outbox connected → pass if ≥50% OR ≥3 outboxes reachable
 *    navigator.onLine is checked first as a fast-fail for offline mode.
 *    If connectivity is insufficient we throw a descriptive error rather
 *    than risk a partial or stale write.
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
 * When only 1 outbox relay is connected, we require this many lookup/index
 * relays to also be connected before allowing a contacts list write.
 * A single outbox relay is not enough confidence on its own.
 */
const MIN_INDEX_RELAYS_FOR_SINGLE_OUTBOX = 2;

/**
 * When >1 outbox relays are connected, we pass if either:
 *   - at least this fraction of the user's outbox relays are connected, OR
 *   - at least MIN_OUTBOX_ABSOLUTE are connected (caps the requirement for
 *     large relay sets — e.g. 30 outboxes should not need 15 connected).
 */
const MIN_OUTBOX_FRACTION = 0.5;
const MIN_OUTBOX_ABSOLUTE = 3;

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

  const getRelaySets = useCallback((): {
    outboxes: string[];
    lookup: string[];
  } => {
    const outboxes = mailboxes?.outboxes ?? [];
    const outboxSet = new Set(outboxes);
    // Lookup relays that are not already in the outbox set
    const lookup = lookupRelays.getValue().filter((r) => !outboxSet.has(r));
    return { outboxes, lookup };
  }, [mailboxes]);

  /**
   * Returns the number of healthy connections in a relay list.
   * A relay is healthy if: WebSocket is open (pool) AND not dead/backoff (liveness).
   */
  const countHealthy = useCallback((relays: string[]): number => {
    const connected = relays.filter(
      (url) => pool.relays.get(url)?.connected === true,
    );
    return liveness.filter(connected).length;
  }, []);

  /**
   * Check that we are connected to enough relays to safely write.
   *
   * Connectivity rules (applied after navigator.onLine fast-fail):
   *
   *   • No outbox relays found → error: we can't be confident we have the
   *     user's latest kind:3 without knowing where they publish.
   *
   *   • Exactly 1 outbox connected → also require ≥2 lookup/index relays.
   *     A single outbox relay is not enough confidence on its own.
   *
   *   • >1 outbox connected → pass if (≥50% of outboxes OR ≥3 outboxes).
   *     The absolute floor prevents requiring 15/30 on large relay sets.
   *
   * Throws a user-facing error if the threshold is not met.
   */
  const assertConnectivity = useCallback(
    (outboxes: string[], lookup: string[]) => {
      // Layer 1: fast-fail on navigator.onLine (catches DevTools offline mode
      // immediately, before WebSocket close events have had time to propagate)
      if (!navigator.onLine) {
        throw new Error(
          "You appear to be offline. Please check your internet connection and try again.",
        );
      }

      // No outbox relay list found — we can't be confident we have the latest kind:3
      if (outboxes.length === 0) {
        throw new Error(
          "Could not find your relay list (NIP-65). Without knowing where you publish, " +
            "we can't be confident we have your latest follow list. " +
            "Please add outbox relays in your relay settings and try again.",
        );
      }

      const healthyOutboxes = countHealthy(outboxes);
      const healthyLookup = countHealthy(lookup);

      if (healthyOutboxes === 0) {
        throw new Error(
          `None of your ${outboxes.length} outbox relay(s) are reachable. ` +
            "Please check your internet connection and try again.",
        );
      }

      if (healthyOutboxes === 1) {
        // Single outbox connection — require backup coverage from index relays
        if (healthyLookup < MIN_INDEX_RELAYS_FOR_SINGLE_OUTBOX) {
          throw new Error(
            `Only 1 of your ${outboxes.length} outbox relay(s) is reachable and ` +
              `only ${healthyLookup} of ${lookup.length} lookup relay(s) are reachable ` +
              `(need at least ${MIN_INDEX_RELAYS_FOR_SINGLE_OUTBOX} lookup relays as backup). ` +
              "Please check your internet connection and try again.",
          );
        }
        return; // 1 outbox + ≥2 lookup is sufficient
      }

      // >1 outbox connected — pass if ≥50% OR ≥3 absolute
      const fraction = healthyOutboxes / outboxes.length;
      if (
        healthyOutboxes < MIN_OUTBOX_ABSOLUTE &&
        fraction < MIN_OUTBOX_FRACTION
      ) {
        throw new Error(
          `Connection is not stable enough to safely update your follow list. ` +
            `Only ${healthyOutboxes} of ${outboxes.length} outbox relay(s) are reachable ` +
            `(need at least ${MIN_OUTBOX_ABSOLUTE} or ${Math.round(MIN_OUTBOX_FRACTION * 100)}%). ` +
            "Please check your internet connection and try again.",
        );
      }
    },
    [countHealthy],
  );

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
        const { outboxes, lookup } = getRelaySets();

        // 1. Connectivity check — fail fast with a clear error
        assertConnectivity(outboxes, lookup);

        // 2. Fetch latest kind:3 from all outbox + lookup relays
        const allRelays = [...outboxes, ...lookup];
        await prefetchContacts(account.pubkey, allRelays);

        // 3. Run the action — now guaranteed to start from the freshest state
        await action(target);
      } finally {
        setPending(false);
      }
    },
    [account?.pubkey, getRelaySets, assertConnectivity, prefetchContacts],
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
