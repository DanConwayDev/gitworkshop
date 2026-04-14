/**
 * useUserActivity — fetch a user's recent git activity.
 *
 * Collects events the user has authored across two relay sources:
 *   1. Their NIP-65 outbox relays (where they publish their own events)
 *   2. Repo relays for repositories they maintain (where PRs/issues land)
 *
 * Activity kinds tracked:
 *   - 1621  Git issue
 *   - 1617  Git patch (root)
 *   - 1618  Git pull request
 *   - 1111  NIP-22 comment on a git item (filtered by K tag)
 *
 * For comments (kind 1111) we only include ones where the `K` tag references
 * a git-related root kind (1621, 1617, 1618, 30617).
 *
 * Results are sorted newest-first and deduplicated by event ID.
 */

import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { pool } from "@/services/nostr";
import { gitIndexRelays } from "@/services/settings";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { resilientSubscription } from "@/lib/resilientSubscription";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  COMMENT_KIND,
  REPO_KIND,
  getRepoRelays,
} from "@/lib/nip34";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import { switchMap, map, of } from "rxjs";

/** Git-related root kinds that make a comment count as git activity. */
const GIT_ROOT_KINDS = new Set([
  String(ISSUE_KIND),
  String(PATCH_KIND),
  String(PR_KIND),
  String(REPO_KIND),
]);

/** All activity kinds to fetch from relays. */
const ACTIVITY_KINDS = [ISSUE_KIND, PATCH_KIND, PR_KIND, COMMENT_KIND];

/** Maximum number of activity items to return. */
const ACTIVITY_LIMIT = 50;

/**
 * Returns true if a kind:1111 comment is on a git-related item.
 * Checks the `K` tag (uppercase) which NIP-22 uses for the root event's kind.
 */
export function isGitComment(event: NostrEvent): boolean {
  if (event.kind !== COMMENT_KIND) return false;
  const kTag = event.tags.find(([t]) => t === "K")?.[1];
  return kTag !== undefined && GIT_ROOT_KINDS.has(kTag);
}

/**
 * Returns true if the event is a git activity item we want to display.
 */
export function isGitActivity(event: NostrEvent): boolean {
  if (event.kind === ISSUE_KIND) return true;
  if (event.kind === PATCH_KIND) return true;
  if (event.kind === PR_KIND) return true;
  if (event.kind === COMMENT_KIND) return isGitComment(event);
  return false;
}

/**
 * Fetch and reactively subscribe to a user's recent git activity.
 *
 * Two-phase fetch:
 *   Phase 1 — outbox relays: query the user's NIP-65 write relays (populated
 *             by useUserProfileSubscription) for their authored activity events.
 *   Phase 2 — repo relays: query the git index relays for repo announcements
 *             authored by this user, then query those repo relays for the same
 *             activity kinds authored by this user.
 *
 * Both phases write into the EventStore. The read layer subscribes to
 * store.timeline() and filters/sorts in memory.
 *
 * @param pubkey - The user's hex pubkey, or undefined to skip
 * @returns Sorted NostrEvent[] (newest first), or undefined while loading
 */
export function useUserActivity(
  pubkey: string | undefined,
): NostrEvent[] | undefined {
  const store = useEventStore();

  // -------------------------------------------------------------------------
  // Phase 1: fetch from outbox relays
  // -------------------------------------------------------------------------
  use$(() => {
    if (!pubkey) return undefined;

    // Use the mailboxes model which is populated by useUserProfileSubscription.
    // switchMap re-subscribes whenever the outbox relay list changes.
    return store.mailboxes(pubkey).pipe(
      map((mailboxes) => mailboxes?.outboxes ?? []),
      switchMap((outboxes) => {
        // Fall back to git index relays if we don't know their outbox yet.
        const relays =
          outboxes.length > 0 ? outboxes : gitIndexRelays.getValue();
        if (relays.length === 0) return of(undefined);

        const filter: Filter = {
          kinds: ACTIVITY_KINDS,
          authors: [pubkey],
          limit: ACTIVITY_LIMIT,
        };

        return resilientSubscription(pool, relays, [filter], {
          paginate: false,
        }).pipe(onlyEvents(), mapEventsToStore(store));
      }),
    );
  }, [pubkey, store]);

  // -------------------------------------------------------------------------
  // Phase 2: fetch from repo relays for repos this user maintains
  // -------------------------------------------------------------------------
  use$(() => {
    if (!pubkey) return undefined;

    // Watch for repo announcements by this user in the store, then query
    // each repo's declared relays for the user's activity on those repos.
    const repoFilter: Filter = {
      kinds: [REPO_KIND],
      authors: [pubkey],
    };

    return (
      store.timeline([repoFilter]) as unknown as Observable<NostrEvent[]>
    ).pipe(
      map((repoEvents) => {
        // Collect all unique relay URLs declared across this user's repos.
        const relaySet = new Set<string>();
        for (const ev of repoEvents) {
          for (const url of getRepoRelays(ev)) {
            relaySet.add(url);
          }
        }
        return [...relaySet];
      }),
      switchMap((repoRelays) => {
        if (repoRelays.length === 0) return of(undefined);

        const filter: Filter = {
          kinds: ACTIVITY_KINDS,
          authors: [pubkey],
          limit: ACTIVITY_LIMIT,
        };

        return resilientSubscription(pool, repoRelays, [filter], {
          paginate: false,
        }).pipe(onlyEvents(), mapEventsToStore(store));
      }),
    );
  }, [pubkey, store]);

  // -------------------------------------------------------------------------
  // Read layer: subscribe to the EventStore and filter/sort
  // -------------------------------------------------------------------------
  const filterKey = useMemo(
    () => JSON.stringify({ kinds: ACTIVITY_KINDS, authors: pubkey }),
    [pubkey],
  );

  const raw = use$(() => {
    if (!pubkey) return undefined;

    const filter: Filter = {
      kinds: ACTIVITY_KINDS,
      authors: [pubkey],
    };

    return (
      store.timeline([filter]) as unknown as Observable<NostrEvent[]>
    ).pipe(
      map((events) =>
        events
          .filter(isGitActivity)
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, ACTIVITY_LIMIT),
      ),
    );
  }, [pubkey, filterKey, store]);

  return raw ?? undefined;
}
