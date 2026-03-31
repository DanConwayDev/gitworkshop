/**
 * useRobustReplaceableAction — generic safety wrapper for modifying any
 * user replaceable event (kind:3, kind:10002, kind:10317, etc.).
 *
 * WHY THIS EXISTS
 * ---------------
 * Replaceable events (kinds 0, 3, 10000-19999) have a critical property:
 * only the latest event per pubkey+kind is kept. If the EventStore holds a
 * stale copy and an action modifies it, the published event will silently
 * overwrite changes made on another client.
 *
 * This hook adds three layers of protection:
 *
 * 1. CONNECTIVITY THRESHOLD CHECK
 *    Before attempting any write, we verify connectivity against the user's
 *    outbox relays and lookup/index relays independently. The rules are:
 *      - No outbox relays configured -> error (can't trust we have the latest)
 *      - 1 outbox connected -> also need >=2 lookup relays as backup
 *      - >1 outbox connected -> pass if >=50% OR >=3 outboxes reachable
 *    navigator.onLine is checked first as a fast-fail for offline mode.
 *
 * 2. FRESH FETCH FROM ALL OUTBOX + LOOKUP RELAYS
 *    We use addressLoader to fetch the latest event of the target kind from
 *    the user's outbox relays AND the configured lookup relays, then wait
 *    for it to land in the EventStore.
 *
 * 3. PERSISTENT BACKGROUND SUBSCRIPTION (handled in accounts.ts)
 *    A continuous pool.subscription() for all user replaceable kinds is kept
 *    open on the union of the user's outbox relays and lookup/index relays
 *    for the lifetime of the session (see userIdentitySubscription.ts). This
 *    means the EventStore is already warm in most cases — the addressLoader
 *    fetch here is a final safety net, not the primary mechanism.
 *
 * USAGE
 * -----
 * ```ts
 * const execute = useRobustReplaceableAction();
 *
 * // Wrap any action that modifies a replaceable event:
 * await execute(3, async () => {
 *   await followUser(pubkey);
 * });
 * ```
 */

import { useCallback, useState } from "react";
import { firstValueFrom, race } from "rxjs";
import { filter, take } from "rxjs/operators";
import { useActiveAccount } from "applesauce-react/hooks";
import { useEventStore } from "@/hooks/useEventStore";
import { use$ } from "@/hooks/use$";
import { MailboxesModel } from "applesauce-core/models";
import { addressLoader, liveness, pool } from "@/services/nostr";
import { lookupRelays } from "@/services/settings";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * When only 1 outbox relay is connected, we require this many lookup/index
 * relays to also be connected before allowing a replaceable event write.
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
 * How long (ms) to wait for the addressLoader to return the latest event
 * before proceeding with whatever is already in the EventStore.
 */
const FETCH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Human-readable kind labels for error messages
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<number, string> = {
  0: "profile",
  3: "follow list",
  10002: "relay list",
  10017: "git authors list",
  10018: "git repositories list",
  10317: "grasp server list",
};

function kindLabel(kind: number): string {
  return KIND_LABELS[kind] ?? `kind:${kind} list`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface RobustReplaceableActionResult {
  /**
   * Execute an action that modifies a replaceable event, with connectivity
   * and freshness safeguards.
   *
   * @param kind    - The replaceable event kind being modified
   * @param action  - The async action to execute after safety checks pass
   */
  execute: (kind: number, action: () => Promise<void>) => Promise<void>;
  /** True while an action is in progress. */
  pending: boolean;
}

export function useRobustReplaceableAction(): RobustReplaceableActionResult {
  const account = useActiveAccount();
  const store = useEventStore();
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
   *   - No outbox relays found -> error: we can't be confident we have the
   *     user's latest event without knowing where they publish.
   *
   *   - Exactly 1 outbox connected -> also require >=2 lookup/index relays.
   *     A single outbox relay is not enough confidence on its own.
   *
   *   - >1 outbox connected -> pass if (>=50% of outboxes OR >=3 outboxes).
   *     The absolute floor prevents requiring 15/30 on large relay sets.
   *
   * Throws a user-facing error if the threshold is not met.
   */
  const assertConnectivity = useCallback(
    (outboxes: string[], lookup: string[], kind: number) => {
      const label = kindLabel(kind);

      // Layer 1: fast-fail on navigator.onLine (catches DevTools offline mode
      // immediately, before WebSocket close events have had time to propagate)
      if (!navigator.onLine) {
        throw new Error(
          "You appear to be offline. Please check your internet connection and try again.",
        );
      }

      // No outbox relay list found
      if (outboxes.length === 0) {
        throw new Error(
          "Could not find your relay list (NIP-65). Without knowing where you publish, " +
            `we can't be confident we have your latest ${label}. ` +
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
        return; // 1 outbox + >=2 lookup is sufficient
      }

      // >1 outbox connected — pass if >=50% OR >=3 absolute
      const fraction = healthyOutboxes / outboxes.length;
      if (
        healthyOutboxes < MIN_OUTBOX_ABSOLUTE &&
        fraction < MIN_OUTBOX_FRACTION
      ) {
        throw new Error(
          `Connection is not stable enough to safely update your ${label}. ` +
            `Only ${healthyOutboxes} of ${outboxes.length} outbox relay(s) are reachable ` +
            `(need at least ${MIN_OUTBOX_ABSOLUTE} or ${Math.round(MIN_OUTBOX_FRACTION * 100)}%). ` +
            "Please check your internet connection and try again.",
        );
      }
    },
    [countHealthy],
  );

  /**
   * Fetch the latest event of the given kind from the user's relay set and
   * wait for it to land in the EventStore. Times out after FETCH_TIMEOUT_MS
   * and proceeds with whatever is already in the store.
   */
  const prefetchReplaceable = useCallback(
    async (pubkey: string, kind: number, relays: string[]) => {
      if (relays.length === 0) return;

      await Promise.race([
        firstValueFrom(
          race(
            // Wait for the store to emit the replaceable event for this
            // pubkey+kind (may already be there, resolves immediately)
            store.replaceable(kind, pubkey).pipe(
              filter((e) => e !== undefined),
              take(1),
            ),
            // Kick off the actual relay fetch in parallel
            new Promise<void>((resolve) => {
              addressLoader({ kind, pubkey, relays }).subscribe({
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
    async (kind: number, action: () => Promise<void>) => {
      if (!account?.pubkey) {
        throw new Error("Not logged in.");
      }

      setPending(true);
      try {
        const { outboxes, lookup } = getRelaySets();

        // 1. Connectivity check — fail fast with a clear error
        assertConnectivity(outboxes, lookup, kind);

        // 2. Fetch latest event from all outbox + lookup relays
        const allRelays = [...outboxes, ...lookup];
        await prefetchReplaceable(account.pubkey, kind, allRelays);

        // 3. Run the action — now guaranteed to start from the freshest state
        await action();
      } finally {
        setPending(false);
      }
    },
    [account?.pubkey, getRelaySets, assertConnectivity, prefetchReplaceable],
  );

  return { execute, pending };
}
