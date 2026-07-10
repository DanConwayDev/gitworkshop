/** Test-only MergePanel transport wiring for Grasp e2e suites. */

import type { NostrEvent } from "nostr-tools";
import type { PackableObject } from "@/lib/git-packfile";
import type { RefUpdate } from "@/lib/git-push";
import type {
  GitGraspPool,
  GraspMergeTransports,
  PushDeliverySummary,
} from "@/lib/git-grasp-pool";
import type { RelayClient } from "./relay-client";

export interface MakePoolTransportsOptions {
  /** Extra URLs the pool may use for catch-up fetches. */
  fallbackUrls?: string[];
  /** Abort signal passed through to pool push catch-up fetches. */
  signal?: AbortSignal;
}

export interface PoolTransportsResult {
  transports: GraspMergeTransports;
  getPushSummary: () => PushDeliverySummary | null;
  events: NostrEvent[];
}

/**
 * Mirror MergePanel's createMergeTransports in e2e tests.
 *
 * The important bit is `pushObjects`: it must call `pool.pushRefUpdate`, not
 * `pushToGitServer` directly, so lagging-mirror/fresh-mirror/catch-up logic in
 * `grasp-push.ts` is exercised by merge scenario tests.
 */
export function makePoolTransports(
  pool: GitGraspPool,
  relays: RelayClient[],
  targetCloneUrls: string[],
  currentStateEvent: NostrEvent | null | undefined,
  options: MakePoolTransportsOptions = {},
): PoolTransportsResult {
  let pushSummary: PushDeliverySummary | null = null;
  const events: NostrEvent[] = [];

  const transports: GraspMergeTransports = {
    publishStateToGrasp: (state) =>
      publishToRelays(state, relays, "state event"),
    pushObjects: async (objects: PackableObject[], refUpdate: RefUpdate) => {
      pushSummary = await pool.pushRefUpdate(objects, refUpdate, {
        targetCloneUrls,
        currentStateEvent,
        fallbackUrls: options.fallbackUrls,
        signal: options.signal,
      });
    },
    publishStatusBroadly: (status) =>
      publishToRelays(status, relays, "status event"),
    publishIssueStatus: (status) =>
      publishToRelays(status, relays, "issue status event"),
    broadcastStateBroadly: (state) =>
      publishToRelays(state, relays, "state broadcast"),
    onEvent: (event) => {
      events.push(event);
    },
  };

  return { transports, getPushSummary: () => pushSummary, events };
}

async function publishToRelays(
  event: NostrEvent,
  relays: RelayClient[],
  label: string,
): Promise<void> {
  if (relays.length === 0) throw new Error(`No Grasp relays for ${label}`);

  const responses = await Promise.allSettled(
    relays.map((relay) => relay.publish(event)),
  );
  if (responses.some((response) => response.status === "fulfilled")) return;

  const reasons = responses
    .map((response, index) => {
      const relay = relays[index];
      const reason =
        response.status === "rejected"
          ? response.reason instanceof Error
            ? response.reason.message
            : String(response.reason)
          : "accepted";
      return `${relay.url}: ${reason}`;
    })
    .join("; ");
  throw new Error(`All Grasp relays rejected ${label}: ${reasons}`);
}
