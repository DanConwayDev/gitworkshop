/**
 * useRepositorySearch
 *
 * Two-mode hook for the RepositoriesPage:
 *
 * Mode 1 — Browse (empty query):
 *   Fetches kind:30617 events page-by-page using an `until` cursor against
 *   gitIndexRelays (or relayOverride). Uses pool.req() so batch.length
 *   reflects the true relay-sent count for cursor advancement.
 *   Returns { repos, isLoading, hasMore, loadMore }.
 *
 * Mode 2 — Search (non-empty query, debounced 300ms):
 *   Fires NIP-50 { kinds: [30617], search: query } against gitIndexRelays.
 *   Simultaneously fires NIP-50 { kinds: [0], search: query } against
 *   relay.ditto.pub for user resolution.
 *   Returns repos from the NIP-50 result set, plus matchedUserPubkeys for
 *   badge display on RepoCards whose maintainer matched a user result.
 *
 * RelayPage fix:
 *   When relayOverride is set, the displayed list is scoped to events that
 *   were actually received from those relays (via getSeenRelays). This
 *   prevents EventStore events from other relays bleeding into the view.
 *
 * All fetched events are piped through mapEventsToStore so downstream
 * components (UserLink, UserAvatar) can reactively read profiles.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { isFromRelay } from "applesauce-core/helpers";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import { pool, eventStore } from "@/services/nostr";
import { gitIndexRelays } from "@/services/settings";
import {
  REPO_KIND,
  groupIntoResolvedRepos,
  type ResolvedRepo,
} from "@/lib/nip34";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { map } from "rxjs/operators";
import type { Observable } from "rxjs";
import { resilientRequest } from "@/lib/resilientSubscription";

// NIP-50 user resolution relay — supports kind:0 search
const USER_SEARCH_RELAY = "wss://relay.ditto.pub";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export interface UseRepositorySearchResult {
  /** Resolved repos to display. undefined = initial loading. */
  repos: ResolvedRepo[] | undefined;
  /** True while a fetch is in flight (initial load or search). */
  isLoading: boolean;
  /** True when there are more pages to load (browse mode only). */
  hasMore: boolean;
  /** Load the next page (browse mode). No-op in search mode. */
  loadMore: () => void;
  /**
   * Pubkeys that matched the NIP-50 kind:0 user search.
   * Empty set in browse mode or when no users matched.
   * Use to show a "matched user" badge on RepoCards.
   */
  matchedUserPubkeys: Set<string>;
}

/**
 * Core hook for repository discovery and search.
 *
 * @param query         - Search query. Empty string = browse mode.
 * @param relayOverride - When set, query only these relays (RelayPage).
 */
export function useRepositorySearch(
  query: string,
  relayOverride?: string[],
): UseRepositorySearchResult {
  const store = useEventStore();

  // Subscribe to gitIndexRelays reactively so relay changes re-trigger
  const liveGitIndexRelays =
    use$(() => gitIndexRelays, []) ?? gitIndexRelays.getValue();

  const relays = relayOverride ?? liveGitIndexRelays;
  const relayKey = relays.join(",");

  // ── Browse mode state ──────────────────────────────────────────────────────
  // browseIsLoading starts true (initial load pending) and is set to false
  // once the first page fetch completes. It is NOT reset when entering/leaving
  // search mode — the browse data persists across search sessions.
  const [browseIsLoading, setBrowseIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  // Cursor: oldest created_at from the last page
  const untilRef = useRef<number | undefined>(undefined);
  // Track whether we've already started the initial fetch for this relay set.
  // null = not yet started; string = relay key of the last started fetch.
  const fetchedRelayKey = useRef<string | null>(null);

  // ── Search mode state ──────────────────────────────────────────────────────
  const [searchIsLoading, setSearchIsLoading] = useState(false);
  // Raw events returned by the NIP-50 kind:30617 search
  const [searchRepoEvents, setSearchRepoEvents] = useState<
    NostrEvent[] | undefined
  >(undefined);
  // Pubkeys matched by the NIP-50 kind:0 user search
  const [matchedUserPubkeys, setMatchedUserPubkeys] = useState<Set<string>>(
    new Set(),
  );

  const trimmedQuery = query.trim();
  const isSearchMode = trimmedQuery.length > 0;

  // ── Browse mode: initial fetch + loadMore ─────────────────────────────────

  const fetchPage = useCallback(
    (
      until: number | undefined,
      onSettle?: () => void,
    ): Promise<NostrEvent[]> => {
      const pageFilter: Filter = {
        kinds: [REPO_KIND],
        limit: PAGE_SIZE,
        ...(until !== undefined ? { until } : {}),
      };

      return new Promise<NostrEvent[]>((resolve) => {
        const batch: NostrEvent[] = [];
        let settled = false;

        const sub = resilientRequest(pool, relays, [pageFilter]).subscribe({
          next: (msg) => {
            if (msg === "EOSE") {
              // Majority of events have arrived — notify caller so loading
              // state can be cleared early while the long tail still collects.
              if (!settled) {
                settled = true;
                onSettle?.();
              }
            } else {
              batch.push(msg);
              // Add to store immediately so profiles are available for render.
              // The Relay class marks each event with addSeenRelay(event, relayUrl)
              // synchronously, so isFromRelay() in the browseRepos observable will
              // correctly scope the view to this relay set.
              eventStore.add(msg);
            }
          },
          error: () => {
            // Non-fatal — resolve with whatever landed
            if (!settled) onSettle?.();
            resolve(batch);
          },
          complete: () => {
            if (!settled) onSettle?.();
            resolve(batch);
          },
        });

        // Return cleanup handle via the promise chain — if the component
        // unmounts before completion the subscription is cleaned up by the
        // cancelled flag in the useEffect below.
        void sub;
      }).then((batch) => {
        if (batch.length < PAGE_SIZE) {
          setHasMore(false);
        } else {
          setHasMore(true);
          const oldest = Math.min(...batch.map((e) => e.created_at));
          untilRef.current = oldest - 1;
        }
        return batch;
      });
    },
    [relays],
  );

  // Initial fetch when relay set changes
  useEffect(() => {
    if (isSearchMode) return;
    if (fetchedRelayKey.current === relayKey) return;
    fetchedRelayKey.current = relayKey;

    // Reset state for new relay set
    untilRef.current = undefined;
    setHasMore(true);
    setBrowseIsLoading(true);

    let cancelled = false;

    fetchPage(undefined, () => {
      if (!cancelled) setBrowseIsLoading(false);
    }).then(() => {
      if (!cancelled) setBrowseIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [relayKey, isSearchMode, fetchPage]);

  const loadMore = useCallback(() => {
    if (!hasMore || browseIsLoading || isSearchMode) return;
    setBrowseIsLoading(true);

    fetchPage(untilRef.current, () => {
      setBrowseIsLoading(false);
    }).then(() => {
      setBrowseIsLoading(false);
    });
  }, [hasMore, browseIsLoading, isSearchMode, fetchPage]);

  // ── Browse mode: reactive read from store, scoped to relay ────────────────

  // All kind:30617 events from the store, filtered to those seen on the
  // current relay set when relayOverride is active (RelayPage fix).
  const browseRepos = use$(() => {
    if (isSearchMode) return undefined;

    return store.timeline([{ kinds: [REPO_KIND] } as Filter]).pipe(
      map((events) => {
        // When relayOverride is set, scope to events seen on those relays.
        // getSeenRelays is set synchronously by the Relay class when an event
        // arrives, so this filter is accurate for events fetched this session.
        const scoped =
          relayOverride && relayOverride.length > 0
            ? events.filter((ev) =>
                relayOverride.some((r) => isFromRelay(ev, r)),
              )
            : events;
        return groupIntoResolvedRepos(scoped);
      }),
    ) as unknown as Observable<ResolvedRepo[]>;
  }, [isSearchMode, store, relayKey]); // relayKey ensures re-sub when relay changes

  // ── Search mode: debounced NIP-50 ─────────────────────────────────────────

  useEffect(() => {
    if (!isSearchMode) {
      // Leaving search mode — clear search state
      setSearchRepoEvents(undefined);
      setMatchedUserPubkeys(new Set());
      setSearchIsLoading(false);
      return;
    }

    // During debounce window: keep previous results, no loading spinner
    const timer = setTimeout(() => {
      setSearchIsLoading(true);

      /**
       * Collect all events from a resilientRequest stream into an array.
       * Calls onSettle() when the "EOSE" settle signal fires (majority of
       * events have arrived) so callers can clear loading state early while
       * the long tail still collects.
       */
      const collectEvents = (
        relayUrls: string[],
        searchFilter: Filter,
        onSettle?: () => void,
      ): Promise<NostrEvent[]> =>
        new Promise<NostrEvent[]>((resolve) => {
          const events: NostrEvent[] = [];
          let settled = false;
          resilientRequest(pool, relayUrls, [searchFilter]).subscribe({
            next: (msg) => {
              if (msg === "EOSE") {
                if (!settled) {
                  settled = true;
                  onSettle?.();
                }
              } else {
                events.push(msg);
              }
            },
            error: () => {
              if (!settled) onSettle?.();
              resolve(events);
            },
            complete: () => {
              if (!settled) onSettle?.();
              resolve(events);
            },
          });
        });

      // Fire both searches in parallel; clear loading as soon as the first
      // EOSE settle signal fires across either search.
      let loadingCleared = false;
      const clearLoading = () => {
        if (!loadingCleared) {
          loadingCleared = true;
          setSearchIsLoading(false);
        }
      };

      Promise.all([
        // NIP-50 repo search against git index relays
        collectEvents(
          relays,
          {
            kinds: [REPO_KIND],
            search: trimmedQuery,
            limit: PAGE_SIZE,
          } as Filter,
          clearLoading,
        ),
        // NIP-50 user search against relay.ditto.pub
        collectEvents(
          [USER_SEARCH_RELAY],
          { kinds: [0], search: trimmedQuery, limit: 10 } as Filter,
          clearLoading,
        ),
      ])
        .then(async ([repoEvents, userEvents]) => {
          // Add all fetched events to the store for reactive profile lookups
          for (const ev of repoEvents) eventStore.add(ev);
          for (const ev of userEvents) eventStore.add(ev);

          const matchedPubkeys = new Set(userEvents.map((ev) => ev.pubkey));

          // Fetch repos authored by matched users so user-name searches return results
          let userRepoEvents: NostrEvent[] = [];
          if (matchedPubkeys.size > 0) {
            userRepoEvents = await collectEvents(relays, {
              kinds: [REPO_KIND],
              authors: [...matchedPubkeys],
              limit: PAGE_SIZE,
            } as Filter);
            for (const ev of userRepoEvents) eventStore.add(ev);
          }

          // Merge repo events, deduplicating by event id
          const allRepoEvents = repoEvents.slice();
          const seenIds = new Set(repoEvents.map((ev) => ev.id));
          for (const ev of userRepoEvents) {
            if (!seenIds.has(ev.id)) {
              seenIds.add(ev.id);
              allRepoEvents.push(ev);
            }
          }

          setSearchRepoEvents(allRepoEvents);
          setMatchedUserPubkeys(matchedPubkeys);
        })
        .catch(() => {
          setSearchRepoEvents([]);
          setMatchedUserPubkeys(new Set());
        })
        .finally(() => {
          clearLoading();
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmedQuery, relayKey, isSearchMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resolve search results into ResolvedRepo[] ────────────────────────────

  const searchRepos = useMemo<ResolvedRepo[] | undefined>(() => {
    if (!isSearchMode) return undefined;
    if (searchRepoEvents === undefined) return undefined; // still loading
    return groupIntoResolvedRepos(searchRepoEvents);
  }, [isSearchMode, searchRepoEvents]);

  // ── Assemble final result ─────────────────────────────────────────────────

  if (isSearchMode) {
    return {
      repos: searchRepos,
      isLoading: searchIsLoading,
      hasMore: false,
      loadMore: () => {},
      matchedUserPubkeys,
    };
  }

  return {
    repos: browseRepos,
    isLoading: browseIsLoading,
    hasMore,
    loadMore,
    matchedUserPubkeys: new Set(),
  };
}
