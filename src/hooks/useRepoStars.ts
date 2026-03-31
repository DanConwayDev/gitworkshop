/**
 * useRepoStars — reactive star count for a repository.
 *
 * Stars are kind:7 reactions with content "+" targeting any of the repo's
 * announcement events (kind:30617) across the full maintainer set. The
 * nip34RepoLoader already fetches these from repo relays via the #a coord
 * filter, so this hook only reads from the in-memory EventStore.
 *
 * Deduplication: a pubkey that has starred multiple announcements for the
 * same repo (e.g. one per maintainer) is counted only once.
 */

import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { useActiveAccount } from "applesauce-react/hooks";
import { ReactionsModel } from "applesauce-common/models";
import type { NostrEvent } from "nostr-tools";
import { combineLatest, of } from "rxjs";

export interface RepoStarsResult {
  /** Deduplicated star count across all maintainer announcements. */
  count: number;
  /** True if the currently logged-in user has starred this repo. */
  isStarred: boolean;
  /** The current user's star event (for deletion), or undefined. */
  myStarEvent: NostrEvent | undefined;
  /** Deduplicated list of pubkeys that have starred this repo. */
  stargazers: string[];
}

/**
 * Subscribe to stars for a set of repo announcement events.
 *
 * @param announcements - The raw kind:30617 announcement events for this repo
 *                        (one per confirmed maintainer). Pass an empty array
 *                        or undefined while the repo is still loading.
 */
export function useRepoStars(
  announcements: NostrEvent[] | undefined,
): RepoStarsResult {
  const store = useEventStore();
  const account = useActiveAccount();
  const myPubkey = account?.pubkey;

  // Stable string key so the factory only re-runs when the announcement set
  // changes, not on every render (avoids passing an inline array expression
  // directly as a dep which would be a new reference each time).
  const announcementIds = (announcements ?? [])
    .map((a) => a.id)
    .sort()
    .join(",");

  // Subscribe to ReactionsModel for each announcement and merge the results.
  // combineLatest emits whenever any announcement's reactions change.
  const allReactionSets = use$(() => {
    const evs = announcements ?? [];
    if (evs.length === 0) return of([] as NostrEvent[][]);
    return combineLatest(evs.map((ev) => store.model(ReactionsModel, ev)));
  }, [announcementIds, store]);

  return useMemo(() => {
    if (!allReactionSets) {
      return {
        count: 0,
        isStarred: false,
        myStarEvent: undefined,
        stargazers: [],
      };
    }

    // Flatten all reaction events across all announcements, keeping only "+"
    // reactions (stars). Deduplicate by pubkey — first occurrence wins for
    // the myStarEvent lookup (most recent would be ideal but ReactionsModel
    // doesn't guarantee order; first is fine for a boolean check).
    const seenPubkeys = new Set<string>();
    let myStarEvent: NostrEvent | undefined;

    for (const reactions of allReactionSets) {
      for (const ev of reactions) {
        if (ev.content !== "+") continue;
        if (seenPubkeys.has(ev.pubkey)) continue;
        seenPubkeys.add(ev.pubkey);
        if (myPubkey && ev.pubkey === myPubkey && !myStarEvent) {
          myStarEvent = ev;
        }
      }
    }

    return {
      count: seenPubkeys.size,
      isStarred: myPubkey ? seenPubkeys.has(myPubkey) : false,
      myStarEvent,
      stargazers: [...seenPubkeys],
    };
  }, [allReactionSets, myPubkey]);
}
