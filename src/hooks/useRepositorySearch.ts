/**
 * useRepositorySearch
 *
 * Two-mode hook for the RepositoriesPage:
 *
 * Mode 1 — Browse (empty query):
 *   Opens a resilientSubscription with manualPaginate$ against gitIndexRelays
 *   (or relayOverride). Events stream into the EventStore as they arrive;
 *   the EOSE settle signal clears isLoading. The IntersectionObserver sentinel
 *   calls loadMore() which fires the manualPaginate$ subject to fetch the next
 *   backward page. hasMore goes false when a page returns fewer than PAGE_SIZE
 *   events.
 *
 * Mode 2 — Search (non-empty committedQuery):
 *   Opens a resilientSubscription with manualPaginate$ for NIP-50
 *   { kinds: [30617], search: query } against gitIndexRelays. Simultaneously
 *   fires a resilientRequest for NIP-50 { kinds: [0], search: query } against
 *   relay.ditto.pub for user resolution, then fetches repos for matched users.
 *   Results are pushed into a per-session BehaviorSubject so the UI always
 *   updates even when eventStore.add() is a no-op (dedup case).
 *
 *   Pubkey-query short-circuit: when the query decodes to a pubkey (raw 64-char
 *   hex or `npub1…`), NIP-50 over kind:0 content won't match — the pubkey is
 *   a top-level event field, not inside `content`. In that case we skip the
 *   kind:0 NIP-50 search entirely, treat the decoded pubkey as the matched
 *   user, and immediately fan out `{ kinds: [REPO_KIND], authors: [hex] }`
 *   against the gitIndexRelays. We still fire a fire-and-forget
 *   `{ kinds: [0], authors: [hex] }` against the user-search relay and the
 *   gitIndex relays so the matched-user badge has profile metadata to render.
 *
 *   Query cache: completed sessions are stored in a Map keyed by
 *   "trimmedQuery|relayKey". On a cache hit the previous BehaviorSubject
 *   (already populated) is reused immediately — no relay request is made.
 *
 * RelayPage fix:
 *   When relayOverride is set, the displayed list is scoped to events that
 *   were actually received from those relays (via isFromRelay). This prevents
 *   EventStore events from other relays bleeding into the view.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { BehaviorSubject, Subject } from "rxjs";
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
import {
  resilientSubscription,
  resilientRequest,
} from "@/lib/resilientSubscription";
import { decodePubkeyIdentifier } from "@/lib/routeUtils";

// NIP-50 user resolution relay — supports kind:0 search
const USER_SEARCH_RELAY = "wss://relay.ditto.pub";

const PAGE_SIZE = 20;
// How long to wait after the last event in a pagination page before concluding
// the page is done. Covers both the normal case (events arrive then stop) and
// the zero-events case (relay exhausted — timer fires with count=0).
const PAGE_SETTLE_MS = 600;

/**
 * Per-relay query outcome for the current search/browse subscription.
 *
 * - "searching" — REQ sent, waiting for EOSE
 * - "success"   — EOSE received (relay answered, regardless of event count)
 * - "error"     — transport failure, permanent CLOSED, or retries exhausted
 */
export type RelayQueryStatus = "searching" | "success" | "error";

export interface UseRepositorySearchResult {
  /** Resolved repos to display. undefined = initial loading. */
  repos: ResolvedRepo[] | undefined;
  /** True while a fetch is in flight (initial load, search, or pagination). */
  isLoading: boolean;
  /** True when there are more pages to load. */
  hasMore: boolean;
  /** Trigger the next page (called by IntersectionObserver sentinel). */
  loadMore: () => void;
  /**
   * Pubkeys that matched the NIP-50 kind:0 user search.
   * Empty set in browse mode or when no users matched.
   * Use to show a "matched user" badge on RepoCards.
   */
  matchedUserPubkeys: Set<string>;
  /**
   * Per-relay query status for the active subscription.
   * All relays start as "searching" when the subscription opens and
   * transition to "success" (EOSE) or "error" (failure) as results arrive.
   * Resets to all-"searching" whenever the relay list or query changes.
   */
  relayStatuses: Record<string, RelayQueryStatus>;
}

// ── Search result cache ───────────────────────────────────────────────────────

interface SearchCacheEntry {
  /** Live results subject — already populated with the last known results. */
  subject: BehaviorSubject<ResolvedRepo[] | undefined>;
  /** Whether there are more pages available for this query. */
  hasMore: boolean;
  /** Pubkeys that matched the NIP-50 user search for this query. */
  matchedUserPubkeys: Set<string>;
  /**
   * Pagination subject for this session — still live if the subscription is
   * open, null if the subscription has been torn down (e.g. relay changed).
   */
  paginate$: Subject<void> | null;
  /** Final per-relay query statuses — restored on cache hit. */
  relayStatuses: Record<string, RelayQueryStatus>;
}

// Module-level cache so it survives re-renders and component remounts.
// Keyed by "trimmedQuery|relayKey".
const searchCache = new Map<string, SearchCacheEntry>();

/**
 * Core hook for repository discovery and search.
 *
 * @param query         - Committed search query. Empty string = browse mode.
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

  const trimmedQuery = query.trim();
  const isSearchMode = trimmedQuery.length > 0;
  // When the query is a raw hex pubkey or `npub1…` bech32, decode it once
  // here so the search effect can short-circuit the kind:0 NIP-50 search
  // (which doesn't index pubkey fields, only content).
  const pubkeyHexFromQuery = isSearchMode
    ? decodePubkeyIdentifier(trimmedQuery)
    : undefined;

  // ── Shared state ───────────────────────────────────────────────────────────

  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  // Browse mode: how many resolved repos to expose to the UI. Starts at
  // PAGE_SIZE and grows by PAGE_SIZE on each loadMore() call so the store
  // timeline is sliced lazily rather than dumping all cached events at once.
  const [browseDisplayLimit, setBrowseDisplayLimit] = useState(PAGE_SIZE);

  // Per-relay query status — initialised to all-"searching" when a subscription
  // opens, then flipped to "success" or "error" via onRelaySettle/onRelayError.
  const [relayStatuses, setRelayStatuses] = useState<
    Record<string, RelayQueryStatus>
  >({});

  // Subject that triggers the next backward page in the active subscription.
  const paginateSubRef = useRef<Subject<void> | null>(null);

  // Settle timer for pagination pages. Started immediately when loadMore() fires
  // (handles zero-events case) and reset on each incoming event. When it fires,
  // the page is considered done.
  const pageSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Count of events received in the current pagination page.
  const pageEventCountRef = useRef(0);
  // Whether we are currently waiting for a pagination page to settle.
  const paginatingRef = useRef(false);

  // Start (or restart) the page settle timer. Called immediately on loadMore()
  // and on every event that arrives while paginatingRef is true.
  const armPageSettleTimer = useCallback((onSettle: () => void) => {
    if (pageSettleTimerRef.current) clearTimeout(pageSettleTimerRef.current);
    pageSettleTimerRef.current = setTimeout(onSettle, PAGE_SETTLE_MS);
  }, []);

  const clearPageSettleTimer = useCallback(() => {
    if (pageSettleTimerRef.current) {
      clearTimeout(pageSettleTimerRef.current);
      pageSettleTimerRef.current = null;
    }
  }, []);

  // ── Browse mode ────────────────────────────────────────────────────────────

  // Full resolved repo list from the store — not sliced here so the
  // subscription stays stable and never briefly returns undefined when the
  // display limit advances (which would hide the sentinel and break scrolling).
  const allBrowseRepos = use$(() => {
    if (isSearchMode) return undefined;

    return store.timeline([{ kinds: [REPO_KIND] } as Filter]).pipe(
      map((events) => {
        const scoped =
          relayOverride && relayOverride.length > 0
            ? events.filter((ev) =>
                relayOverride.some((r) => isFromRelay(ev, r)),
              )
            : events;
        return groupIntoResolvedRepos(scoped);
      }),
    ) as unknown as Observable<ResolvedRepo[]>;
  }, [isSearchMode, store, relayKey]);

  // Apply the display limit outside of use$ so advancing it never causes a
  // re-subscribe (which would briefly yield undefined and hide the sentinel).
  const browseRepos =
    allBrowseRepos !== undefined
      ? allBrowseRepos.slice(0, browseDisplayLimit)
      : undefined;

  useEffect(() => {
    if (isSearchMode) return;

    setIsLoading(true);
    setHasMore(true);
    setBrowseDisplayLimit(PAGE_SIZE);
    paginatingRef.current = false;

    // Initialise all relays as "searching" for this subscription.
    setRelayStatuses(Object.fromEntries(relays.map((r) => [r, "searching"])));

    const paginate$ = new Subject<void>();
    paginateSubRef.current = paginate$;

    // Events received before EOSE (the initial page).
    let initialPageCount = 0;

    const sub = resilientSubscription(
      pool,
      relays,
      [{ kinds: [REPO_KIND], limit: PAGE_SIZE } as Filter],
      {
        manualPaginate$: paginate$,
        limit: PAGE_SIZE,
        onRelaySettle: (relay) =>
          setRelayStatuses((prev) => ({ ...prev, [relay]: "success" })),
        onRelayError: (relay) =>
          setRelayStatuses((prev) => ({ ...prev, [relay]: "error" })),
      },
    ).subscribe({
      next: (msg) => {
        if (msg === "EOSE") {
          setHasMore(initialPageCount >= PAGE_SIZE);
          setIsLoading(false);
          return;
        }
        const ev = msg as NostrEvent;
        eventStore.add(ev);

        if (paginatingRef.current) {
          // Counting events in a pagination page — reset the settle timer.
          pageEventCountRef.current++;
          armPageSettleTimer(() => {
            paginatingRef.current = false;
            setHasMore(pageEventCountRef.current >= PAGE_SIZE);
            setIsLoading(false);
          });
        } else {
          initialPageCount++;
        }
      },
      error: () => {
        clearPageSettleTimer();
        setIsLoading(false);
      },
      complete: () => {
        clearPageSettleTimer();
        setIsLoading(false);
      },
    });

    return () => {
      sub.unsubscribe();
      paginate$.complete();
      paginateSubRef.current = null;
      clearPageSettleTimer();
    };
  }, [relayKey, isSearchMode, armPageSettleTimer, clearPageSettleTimer]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Search mode ────────────────────────────────────────────────────────────

  const [matchedUserPubkeys, setMatchedUserPubkeys] = useState<Set<string>>(
    new Set(),
  );

  // A BehaviorSubject that emits the current session's resolved repos directly.
  // Using a subject rather than store.timeline() + filter avoids the dedup
  // problem: when a repeated query causes the relay to re-deliver events that
  // are already in the EventStore, eventStore.add() is a no-op and never
  // notifies store.timeline() subscribers — so the results would stay blank.
  // By pushing resolved repos into this subject ourselves whenever an event
  // arrives (or is confirmed already in the store), we always get an emission.
  const searchReposSubjectRef = useRef<
    BehaviorSubject<ResolvedRepo[] | undefined>
  >(new BehaviorSubject<ResolvedRepo[] | undefined>(undefined));
  // Bumped each time a new search session starts so that use$ re-subscribes
  // to the freshly-created (or cache-restored) BehaviorSubject.
  const [searchSessionKey, setSearchSessionKey] = useState(0);

  // Reactive read of search results — driven by the subject above.
  // searchSessionKey in deps ensures use$ re-subscribes to the new subject
  // instance created for each query (including cache hits).
  const searchRepos = use$(() => {
    if (!isSearchMode) return undefined;
    return searchReposSubjectRef.current;
  }, [isSearchMode, searchSessionKey]);

  useEffect(() => {
    if (!isSearchMode) {
      setMatchedUserPubkeys(new Set());
      setIsLoading(false);
      return;
    }

    const cacheKey = `${trimmedQuery}|${relayKey}`;
    const cached = searchCache.get(cacheKey);

    if (cached) {
      // Cache hit — restore state immediately, no relay request needed.
      searchReposSubjectRef.current = cached.subject;
      paginateSubRef.current = cached.paginate$;
      setSearchSessionKey((k) => k + 1);
      setHasMore(cached.hasMore);
      setMatchedUserPubkeys(cached.matchedUserPubkeys);
      setIsLoading(false);
      paginatingRef.current = false;
      clearPageSettleTimer();
      // Restore the final relay statuses from the completed session.
      setRelayStatuses(cached.relayStatuses);
      return;
    }

    // Cache miss — start a fresh search session.
    setMatchedUserPubkeys(new Set());
    setHasMore(true);
    paginatingRef.current = false;
    clearPageSettleTimer();

    // Initialise all relays as "searching" for this subscription.
    setRelayStatuses(Object.fromEntries(relays.map((r) => [r, "searching"])));

    let repoSub: { unsubscribe(): void } | null = null;
    let userSub: { unsubscribe(): void } | null = null;
    let userRepoSub: { unsubscribe(): void } | null = null;

    setIsLoading(true);

    // Fresh session: new ID set + new subject.
    const sessionIds = new Set<string>();
    const subject = new BehaviorSubject<ResolvedRepo[] | undefined>(undefined);
    searchReposSubjectRef.current = subject;
    // Bump the session key so use$ re-subscribes to this new subject instance.
    setSearchSessionKey((k) => k + 1);

    // Build the cache entry upfront so pagination callbacks can update it.
    const cacheEntry: SearchCacheEntry = {
      subject,
      hasMore: true,
      matchedUserPubkeys: new Set(),
      paginate$: null,
      relayStatuses: Object.fromEntries(
        relays.map((r) => [r, "searching" as RelayQueryStatus]),
      ),
    };
    searchCache.set(cacheKey, cacheEntry);

    // Helper: rebuild and push the current resolved repo list into the subject.
    // Called on every incoming event (new or duplicate-in-store) so the UI
    // always updates even when eventStore.add() is a no-op (dedup case).
    const pushResults = () => {
      const events = eventStore.getTimeline([{ kinds: [REPO_KIND] } as Filter]);
      subject.next(
        groupIntoResolvedRepos(events.filter((ev) => sessionIds.has(ev.id))),
      );
    };

    const paginate$ = new Subject<void>();
    paginateSubRef.current = paginate$;
    cacheEntry.paginate$ = paginate$;

    // One-shot guard: clears isLoading after the initial EOSE from either
    // search. Pagination loading is managed separately via the settle timer.
    let initialLoadingCleared = false;
    let initialPageCount = 0;

    const clearInitialLoading = () => {
      if (!initialLoadingCleared) {
        initialLoadingCleared = true;
        const more = initialPageCount >= PAGE_SIZE;
        cacheEntry.hasMore = more;
        setHasMore(more);
        // Always push results (even an empty array) so the subject transitions
        // from undefined → [] when there are no matches. Without this, repos
        // stays undefined after EOSE and the skeleton never clears.
        pushResults();
        setIsLoading(false);
      }
    };

    // NIP-50 repo search with manual pagination.
    repoSub = resilientSubscription(
      pool,
      relays,
      [
        {
          kinds: [REPO_KIND],
          search: trimmedQuery,
          limit: PAGE_SIZE,
        } as Filter,
      ],
      {
        manualPaginate$: paginate$,
        limit: PAGE_SIZE,
        onRelaySettle: (relay) => {
          cacheEntry.relayStatuses = {
            ...cacheEntry.relayStatuses,
            [relay]: "success",
          };
          setRelayStatuses((prev) => ({ ...prev, [relay]: "success" }));
        },
        onRelayError: (relay) => {
          cacheEntry.relayStatuses = {
            ...cacheEntry.relayStatuses,
            [relay]: "error",
          };
          setRelayStatuses((prev) => ({ ...prev, [relay]: "error" }));
        },
      },
    ).subscribe({
      next: (msg) => {
        if (msg === "EOSE") {
          clearInitialLoading();
          return;
        }
        const ev = msg as NostrEvent;
        sessionIds.add(ev.id);
        eventStore.add(ev);
        // Push results regardless of whether eventStore.add was a no-op.
        pushResults();

        if (paginatingRef.current) {
          pageEventCountRef.current++;
          armPageSettleTimer(() => {
            paginatingRef.current = false;
            const more = pageEventCountRef.current >= PAGE_SIZE;
            cacheEntry.hasMore = more;
            setHasMore(more);
            setIsLoading(false);
          });
        } else {
          initialPageCount++;
        }
      },
      error: () => {
        clearPageSettleTimer();
        clearInitialLoading();
      },
      complete: () => {
        clearPageSettleTimer();
        clearInitialLoading();
      },
    });

    // NIP-50 user search (one-shot) — collect pubkeys then fetch their repos.
    const userPubkeys = new Set<string>();

    const startUserRepoFetch = () => {
      if (userPubkeys.size === 0) return;
      userRepoSub = resilientRequest(pool, relays, [
        {
          kinds: [REPO_KIND],
          authors: [...userPubkeys],
          limit: PAGE_SIZE,
        } as Filter,
      ]).subscribe({
        next: (msg) => {
          if (msg === "EOSE") return;
          const ev = msg as NostrEvent;
          if (!sessionIds.has(ev.id)) {
            sessionIds.add(ev.id);
            eventStore.add(ev);
            pushResults();
          }
        },
      });
    };

    if (pubkeyHexFromQuery) {
      // Pubkey-query short-circuit. NIP-50 `search:` indexes the kind:0
      // content blob, which does not contain the author's pubkey. Searching
      // for the pubkey string against any relay returns zero kind:0 events,
      // so the matched-user path never fires and the search appears broken.
      //
      // Instead: treat the decoded pubkey as the matched user immediately
      // (no kind:0 round-trip needed), and fetch profile metadata via an
      // `authors:` filter so the UserLink badge can render the name/avatar.
      // The metadata fetch is fire-and-forget — clearInitialLoading() is
      // driven by the repo search EOSE as usual.
      userPubkeys.add(pubkeyHexFromQuery);
      const pubkeySet = new Set(userPubkeys);
      cacheEntry.matchedUserPubkeys = pubkeySet;
      setMatchedUserPubkeys(pubkeySet);
      // Fetch profile metadata from the user-search relay AND the gitIndex
      // relays — profile events are commonly carried by both.
      const profileRelays = Array.from(new Set([USER_SEARCH_RELAY, ...relays]));
      userSub = resilientRequest(pool, profileRelays, [
        { kinds: [0], authors: [pubkeyHexFromQuery] } as Filter,
      ]).subscribe({
        next: (msg) => {
          if (msg === "EOSE") return;
          eventStore.add(msg as NostrEvent);
        },
      });
      startUserRepoFetch();
    } else {
      userSub = resilientRequest(
        pool,
        [USER_SEARCH_RELAY],
        [{ kinds: [0], search: trimmedQuery, limit: 10 } as Filter],
      ).subscribe({
        next: (msg) => {
          if (msg === "EOSE") {
            clearInitialLoading();
            const pubkeySet = new Set(userPubkeys);
            cacheEntry.matchedUserPubkeys = pubkeySet;
            setMatchedUserPubkeys(pubkeySet);
            startUserRepoFetch();
            return;
          }
          const ev = msg as NostrEvent;
          userPubkeys.add(ev.pubkey);
          eventStore.add(ev);
        },
        error: clearInitialLoading,
        complete: () => {
          clearInitialLoading();
          const pubkeySet = new Set(userPubkeys);
          cacheEntry.matchedUserPubkeys = pubkeySet;
          setMatchedUserPubkeys(pubkeySet);
          startUserRepoFetch();
        },
      });
    }

    return () => {
      repoSub?.unsubscribe();
      userSub?.unsubscribe();
      userRepoSub?.unsubscribe();
      // Null out the paginate$ ref in the cache entry so a future cache hit
      // knows the subscription is no longer live (loadMore will be a no-op).
      cacheEntry.paginate$ = null;
      paginateSubRef.current = null;
      clearPageSettleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relays captured via relayKey
  }, [
    trimmedQuery,
    relayKey,
    isSearchMode,
    pubkeyHexFromQuery,
    armPageSettleTimer,
    clearPageSettleTimer,
  ]);

  // ── loadMore ───────────────────────────────────────────────────────────────

  const loadMore = useCallback(() => {
    if (!hasMore || isLoading || !paginateSubRef.current) return;
    setIsLoading(true);
    // Advance the display window so the newly-fetched events become visible
    // once they arrive.
    if (!isSearchMode) {
      setBrowseDisplayLimit((prev) => prev + PAGE_SIZE);
    }
    pageEventCountRef.current = 0;
    paginatingRef.current = true;
    // Arm the settle timer immediately — handles the zero-events case where the
    // relay is exhausted and no events arrive to reset the timer.
    armPageSettleTimer(() => {
      paginatingRef.current = false;
      setHasMore(pageEventCountRef.current >= PAGE_SIZE);
      setIsLoading(false);
    });
    paginateSubRef.current.next();
  }, [hasMore, isLoading, isSearchMode, armPageSettleTimer]);

  // ── Assemble final result ──────────────────────────────────────────────────

  if (isSearchMode) {
    return {
      repos: searchRepos,
      isLoading,
      hasMore,
      loadMore,
      matchedUserPubkeys,
      relayStatuses,
    };
  }

  return {
    repos: browseRepos,
    isLoading,
    hasMore,
    loadMore,
    matchedUserPubkeys: new Set(),
    relayStatuses,
  };
}
