/**
 * useCreateRepo — orchestration hook for the repo creation flow.
 *
 * Coordinates the full sequence:
 *   1. Build git objects (blob → tree → commit → packfile)
 *   2. Sign kind:30617 (announcement) and kind:30618 (state) events
 *   3. Publish events to the Grasp relay (purgatory) + outbox/index relays
 *   4. Push the packfile to the Grasp git HTTP endpoint
 *
 * Exposes step-by-step progress state for the UI.
 */

import { useCallback, useRef, useState } from "react";
import { useActiveAccount } from "applesauce-react/hooks";
import { nip19 } from "nostr-tools";
import type { NostrEvent, EventTemplate } from "nostr-tools";
import { createInitialCommit } from "@/lib/create-repo";
import {
  RepoAnnouncementBlueprint,
  RepoStateBlueprint,
} from "@/blueprints/repo";
import { factory } from "@/services/actions";
import { eventStore, pool } from "@/services/nostr";
import { outboxStore } from "@/services/outbox";

import { pushToGitServer, ZERO_HASH, type RefUpdate } from "@/lib/git-push";
import { useProfile } from "@/hooks/useProfile";
import type { GraspServer } from "@/hooks/useGraspServers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Progress step for the UI. */
export type CreateRepoStep =
  | "idle"
  | "building-commit"
  | "signing-events"
  | "publishing-announcement"
  | "publishing-state"
  | "pushing"
  | "done"
  | "error";

/** Full state exposed to the dialog. */
export interface CreateRepoState {
  step: CreateRepoStep;
  error?: string;
  /** Timestamp (ms) when events were published — for purgatory countdown */
  publishedAt?: number;
  /** The Grasp clone URL on success */
  cloneUrl?: string;
  /** The commit hash on success */
  commitHash?: string;
  /** The repo identifier (d-tag) on success */
  identifier?: string;
}

/** Input from the dialog form. */
export interface CreateRepoFormInput {
  /** Human-readable repo name */
  name: string;
  /** Optional description */
  description: string;
  /** The validated d-tag identifier */
  identifier: string;
  /** The selected Grasp servers to publish to */
  graspServers: GraspServer[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCreateRepo() {
  const account = useActiveAccount();
  const pubkey = account?.pubkey;
  const npub = pubkey ? nip19.npubEncode(pubkey) : undefined;
  const profile = useProfile(pubkey);

  const [state, setState] = useState<CreateRepoState>({ step: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ step: "idle" });
  }, []);

  const execute = useCallback(
    async (input: CreateRepoFormInput) => {
      if (!account || !pubkey || !npub) {
        setState({ step: "error", error: "Not logged in" });
        return;
      }

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        // ── Step 1: Build git objects ──────────────────────────────────
        setState({ step: "building-commit" });

        const authorName =
          profile?.displayName ?? profile?.name ?? npub.slice(0, 16);

        const { commitHash, packfile } = await createInitialCommit({
          repoName: input.name,
          description: input.description || undefined,
          authorName,
          npub,
        });

        if (abort.signal.aborted) return;

        // ── Step 2: Sign Nostr events ─────────────────────────────────
        setState({ step: "signing-events" });

        // Build clone URLs and relay URLs for all selected Grasp servers
        const cloneUrls = input.graspServers.map(
          (s) => `https://${s.domain}/${npub}/${input.identifier}.git`,
        );
        const relayUrls = input.graspServers.map((s) => s.wsUrl);

        // Create event templates via the factory (uses the active account's signer)
        const announcementTemplate = await factory.create(
          RepoAnnouncementBlueprint,
          input.identifier,
          input.name,
          input.description,
          cloneUrls,
          relayUrls,
          commitHash,
        );

        const stateTemplate = await factory.create(
          RepoStateBlueprint,
          input.identifier,
          commitHash,
          "main",
        );

        // Sign both events
        const signedAnnouncement = await account.signer.signEvent(
          announcementTemplate as EventTemplate,
        );
        const signedState = await account.signer.signEvent(
          stateTemplate as EventTemplate,
        );

        if (abort.signal.aborted) return;

        // ── Step 3: Publish announcement ──────────────────────────────
        setState({ step: "publishing-announcement" });

        // Publish to Grasp relays directly and await their response
        // so we know the events are in purgatory before pushing.
        const graspRelayUrls = input.graspServers.map((s) => s.wsUrl);

        await publishToGraspRelays(
          signedAnnouncement,
          graspRelayUrls,
          abort.signal,
        );

        // Also publish to outbox/index relays (fire-and-forget via outbox store)
        await outboxStore.publish(signedAnnouncement, [
          "git-index",
          "fallback-relays",
        ]);

        // Add to local store for immediate UI update
        eventStore.add(signedAnnouncement);

        if (abort.signal.aborted) return;

        // ── Step 4: Publish state ─────────────────────────────────────
        setState({ step: "publishing-state" });

        await publishToGraspRelays(signedState, graspRelayUrls, abort.signal);

        // Add to local store
        eventStore.add(signedState);

        const publishedAt = Date.now();

        if (abort.signal.aborted) return;

        // ── Step 5: Push packfile to ALL Grasp servers ─────────────────
        setState({
          step: "pushing",
          publishedAt,
          identifier: input.identifier,
        });

        const refUpdates: RefUpdate[] = [
          {
            oldHash: ZERO_HASH,
            newHash: commitHash,
            refName: "refs/heads/main",
          },
        ];

        // Push to every Grasp server in parallel. Each server has its
        // own purgatory state event, so each needs the git data.
        const pushResults = await Promise.allSettled(
          cloneUrls.map((url) =>
            pushToGitServer(url, refUpdates, packfile, abort.signal),
          ),
        );

        // Collect errors — at least one server must succeed
        const errors: string[] = [];
        let anySuccess = false;

        for (let i = 0; i < pushResults.length; i++) {
          const result = pushResults[i];
          const url = cloneUrls[i];

          if (result.status === "rejected") {
            errors.push(
              `${url}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
            );
            continue;
          }

          const pushResult = result.value;
          if (!pushResult.unpackOk) {
            errors.push(`${url}: unpack failed`);
            continue;
          }

          const failedRefs = pushResult.refResults.filter((r) => !r.ok);
          if (failedRefs.length > 0) {
            const reasons = failedRefs
              .map((r) => `${r.refName}: ${r.reason ?? "unknown"}`)
              .join(", ");
            errors.push(`${url}: ${reasons}`);
            continue;
          }

          anySuccess = true;
        }

        if (!anySuccess) {
          throw new Error(
            `Git push failed on all servers:\n${errors.join("\n")}`,
          );
        }

        // Use the first clone URL as the canonical one for display
        const primaryCloneUrl = cloneUrls[0];

        // ── Done ──────────────────────────────────────────────────────
        setState({
          step: "done",
          cloneUrl: primaryCloneUrl,
          commitHash,
          identifier: input.identifier,
          publishedAt,
        });
      } catch (err) {
        if (abort.signal.aborted) return;

        const message =
          err instanceof Error ? err.message : "An unknown error occurred";
        setState((prev) => ({
          ...prev,
          step: "error",
          error: message,
        }));
      }
    },
    [account, pubkey, npub, profile],
  );

  /**
   * Retry just the push step. Only valid when the previous attempt failed
   * at the push step (events are already in purgatory).
   */
  const retryPush = useCallback(
    async (input: CreateRepoFormInput, commitHash: string) => {
      if (!npub) {
        setState((prev) => ({
          ...prev,
          step: "error",
          error: "Not logged in",
        }));
        return;
      }

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        setState((prev) => ({ ...prev, step: "pushing", error: undefined }));

        // Rebuild the packfile for retry
        const authorName =
          profile?.displayName ?? profile?.name ?? npub.slice(0, 16);

        const result = await createInitialCommit({
          repoName: input.name,
          description: input.description || undefined,
          authorName,
          npub,
        });

        const cloneUrls = input.graspServers.map(
          (s) => `https://${s.domain}/${npub}/${input.identifier}.git`,
        );

        const refUpdates: RefUpdate[] = [
          {
            oldHash: ZERO_HASH,
            newHash: commitHash,
            refName: "refs/heads/main",
          },
        ];

        // Push to all Grasp servers in parallel
        const pushResults = await Promise.allSettled(
          cloneUrls.map((url) =>
            pushToGitServer(url, refUpdates, result.packfile, abort.signal),
          ),
        );

        let anySuccess = false;
        const errors: string[] = [];

        for (let i = 0; i < pushResults.length; i++) {
          const pr = pushResults[i];
          const url = cloneUrls[i];
          if (pr.status === "rejected") {
            errors.push(
              `${url}: ${pr.reason instanceof Error ? pr.reason.message : String(pr.reason)}`,
            );
            continue;
          }
          if (!pr.value.unpackOk) {
            errors.push(`${url}: unpack failed`);
            continue;
          }
          const failedRefs = pr.value.refResults.filter((r) => !r.ok);
          if (failedRefs.length > 0) {
            errors.push(
              `${url}: ${failedRefs.map((r) => r.reason ?? "unknown").join(", ")}`,
            );
            continue;
          }
          anySuccess = true;
        }

        if (!anySuccess) {
          throw new Error(
            `Git push failed on all servers:\n${errors.join("\n")}`,
          );
        }

        const primaryCloneUrl = cloneUrls[0];

        setState({
          step: "done",
          cloneUrl: primaryCloneUrl,
          commitHash,
          identifier: input.identifier,
        });
      } catch (err) {
        if (abort.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "An unknown error occurred";
        setState((prev) => ({ ...prev, step: "error", error: message }));
      }
    },
    [npub, profile],
  );

  return {
    state,
    execute,
    retryPush,
    reset,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Publish an event to Grasp relays and await at least one successful response.
 * Throws if all relays reject the event.
 */
async function publishToGraspRelays(
  event: NostrEvent,
  relayUrls: string[],
  signal: AbortSignal,
): Promise<void> {
  if (relayUrls.length === 0) {
    throw new Error("No Grasp relay URLs provided");
  }

  // Use the pool to publish and collect responses
  const responses = await pool.publish(relayUrls, event);

  // Check if aborted during publish
  if (signal.aborted) return;

  // Check if at least one relay accepted the event
  const accepted = responses.filter((r) => r.ok);
  if (accepted.length === 0) {
    const reasons = responses
      .map((r) => `${r.from}: ${r.message ?? "rejected"}`)
      .join("; ");
    throw new Error(`All Grasp relays rejected the event: ${reasons}`);
  }
}
