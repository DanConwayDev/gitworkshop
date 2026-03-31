/**
 * useRepoFollowers — reactive follower count for a repository.
 *
 * Followers are kind:10018 (NIP-51 Git repositories follow list) events that
 * contain at least one of the repo's announcement coordinates as an `a` tag.
 * The nip34RepoLoader fetches these from repo relays via the #a coord filter,
 * so this hook only reads from the in-memory EventStore.
 *
 * A single filter with all coordinates in `#a` is used — relays treat
 * multi-value tag filters as OR, so one subscription covers all maintainers.
 *
 * Deduplication: a pubkey that has followed multiple announcements for the
 * same repo (e.g. one per maintainer) is counted only once.
 */

import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

/** kind:10018 — NIP-51 Git repositories follow list */
const GIT_REPOS_KIND = 10018;

export interface RepoFollowersResult {
  /** Deduplicated follower count across all maintainer announcement coordinates. */
  count: number;
}

/**
 * Subscribe to follower counts for a set of repo announcement coordinates.
 *
 * @param coords - The "30617:<pubkey>:<dtag>" coordinate strings for this repo
 *                 (one per confirmed maintainer). Pass an empty array or
 *                 undefined while the repo is still loading.
 */
export function useRepoFollowers(
  coords: string[] | undefined,
): RepoFollowersResult {
  const store = useEventStore();

  // Stable key so the factory only re-runs when the coord set changes
  const coordKey = (coords ?? []).slice().sort().join(",");

  // A single filter with all coords in `#a` — relays treat multi-value tag
  // filters as OR, so one subscription covers all maintainer announcements.
  const followers = use$(() => {
    const cs = coords ?? [];
    if (cs.length === 0) return undefined;
    const filter = { kinds: [GIT_REPOS_KIND], "#a": cs } as Filter;
    return store.timeline([filter]) as unknown as Observable<NostrEvent[]>;
  }, [coordKey, store]);

  return useMemo(() => {
    if (!followers) return { count: 0 };

    // Deduplicate by pubkey — a user who followed multiple announcements
    // for the same repo (one per maintainer) is counted only once.
    const seenPubkeys = new Set<string>();
    for (const ev of followers) {
      seenPubkeys.add(ev.pubkey);
    }

    return { count: seenPubkeys.size };
  }, [followers]);
}
