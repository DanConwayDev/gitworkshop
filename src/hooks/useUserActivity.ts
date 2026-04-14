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
 *   - 1624  Cover note on a git item
 *   - 1630  Status: open
 *   - 1631  Status: resolved
 *   - 1632  Status: closed
 *   - 1633  Status: draft
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
  COVER_NOTE_KIND,
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_DRAFT,
  REPO_KIND,
  getRepoRelays,
} from "@/lib/nip34";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import { switchMap, map, of, distinctUntilChanged } from "rxjs";

/** Root item kinds — events that carry the `a` repo coord tag directly. */
const ROOT_ITEM_KINDS = new Set([ISSUE_KIND, PATCH_KIND, PR_KIND]);

/**
 * Extract the parent root event ID from a secondary event.
 * Mirrors the logic in ActivityFeed.tsx `getParentEventId`.
 */
function getSecondaryParentId(event: NostrEvent): string | undefined {
  // NIP-22 comments use uppercase E for the thread root
  if (event.kind === COMMENT_KIND) {
    return event.tags.find(([t]) => t === "E")?.[1];
  }
  // Status events and cover notes: prefer e tag with "root" marker
  const rootMarked = event.tags.find(
    ([t, , , marker]) => t === "e" && marker === "root",
  )?.[1];
  if (rootMarked) return rootMarked;
  return event.tags.find(([t]) => t === "e")?.[1];
}

/** Returns true for secondary event kinds that reference a root item. */
function isSecondaryKind(kind: number): boolean {
  return (
    kind === COMMENT_KIND ||
    kind === COVER_NOTE_KIND ||
    kind === STATUS_OPEN ||
    kind === STATUS_RESOLVED ||
    kind === STATUS_CLOSED ||
    kind === STATUS_DRAFT
  );
}

/** Git-related root kinds that make a comment or cover note count as git activity. */
const GIT_ROOT_KINDS = new Set([
  String(ISSUE_KIND),
  String(PATCH_KIND),
  String(PR_KIND),
  String(REPO_KIND),
]);

/** Status event kinds. */
export const STATUS_KINDS_ACTIVITY = [
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_DRAFT,
] as const;

/** All activity kinds to fetch from relays. */
const ACTIVITY_KINDS = [
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  COMMENT_KIND,
  COVER_NOTE_KIND,
  ...STATUS_KINDS_ACTIVITY,
];

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
 * Returns true if a kind:1624 cover note is on a git-related item.
 * Checks the `k` tag (lowercase) which cover notes use for the root event's kind.
 */
export function isGitCoverNote(event: NostrEvent): boolean {
  if (event.kind !== COVER_NOTE_KIND) return false;
  const kTag = event.tags.find(([t]) => t === "k")?.[1];
  return kTag !== undefined && GIT_ROOT_KINDS.has(kTag);
}

/**
 * Returns true if a status event (1630-1633) references a git item.
 * Checks the `k` tag for the root event's kind.
 */
export function isGitStatusEvent(event: NostrEvent): boolean {
  if (!(STATUS_KINDS_ACTIVITY as readonly number[]).includes(event.kind))
    return false;
  // Status events reference the root item via an `e` tag; the `k` tag
  // (lowercase) holds the root event's kind.
  const kTag = event.tags.find(([t]) => t === "k")?.[1];
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
  if (event.kind === COVER_NOTE_KIND) return isGitCoverNote(event);
  if ((STATUS_KINDS_ACTIVITY as readonly number[]).includes(event.kind))
    return isGitStatusEvent(event);
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
  // Phase 3: fetch missing root events for orphaned secondary events
  //
  // Secondary events (comments, status changes, cover notes) reference their
  // parent root event (issue/PR/patch) via an E or e tag. When those root
  // events aren't in the store yet, the activity feed can't resolve the repo
  // coordinate and shows "No repository". This phase watches the activity
  // events in the store, finds any secondary events whose parent root isn't
  // present, and fetches those missing parents from the outbox relays.
  // -------------------------------------------------------------------------
  use$(() => {
    if (!pubkey) return undefined;

    const activityFilter: Filter = {
      kinds: ACTIVITY_KINDS,
      authors: [pubkey],
    };

    // Combine the activity timeline with the user's outbox relays so we can
    // fetch missing parents from the right relays.
    return store.mailboxes(pubkey).pipe(
      map((mailboxes) => mailboxes?.outboxes ?? []),
      switchMap((outboxes) => {
        const relays =
          outboxes.length > 0 ? outboxes : gitIndexRelays.getValue();

        return (
          store.timeline([activityFilter]) as unknown as Observable<
            NostrEvent[]
          >
        ).pipe(
          // Collect the set of missing parent IDs as a sorted string so we
          // only re-subscribe when the set actually changes.
          map((events) => {
            const missingIds = new Set<string>();
            for (const ev of events) {
              if (!isSecondaryKind(ev.kind)) continue;
              const parentId = getSecondaryParentId(ev);
              if (!parentId) continue;
              if (!store.getEvent(parentId)) missingIds.add(parentId);
            }
            return [...missingIds].sort().join(",");
          }),
          distinctUntilChanged(),
          switchMap((missingKey) => {
            if (!missingKey || relays.length === 0) return of(undefined);

            const ids = missingKey.split(",").filter(Boolean);
            if (ids.length === 0) return of(undefined);

            const filter: Filter = {
              kinds: [...ROOT_ITEM_KINDS],
              ids,
            };

            return resilientSubscription(pool, relays, [filter], {
              paginate: false,
            }).pipe(onlyEvents(), mapEventsToStore(store));
          }),
        );
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
