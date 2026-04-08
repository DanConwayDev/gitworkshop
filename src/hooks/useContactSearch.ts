import { useState, useEffect, useMemo } from "react";
import { use$ } from "@/hooks/use$";
import { useMyUser } from "@/hooks/useUser";
import { useEventStore } from "@/hooks/useEventStore";
import { pool } from "@/services/nostr";
import { lookupRelays } from "@/services/settings";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { getProfileContent, isValidProfile } from "applesauce-core/helpers";
import type { Filter } from "applesauce-core/helpers";
import type { ProfileContent } from "applesauce-core/helpers";
import { merge } from "rxjs";
import { map, scan, startWith } from "rxjs/operators";

// NIP-50 search relay — relay.ditto.pub supports the `search` filter field
const NIP50_RELAY = "wss://relay.ditto.pub";
const NIP50_DEBOUNCE_MS = 300;
const MAX_RESULTS = 8;

/** kind:10017 — NIP-51 Git authors follow list */
const GIT_AUTHORS_KIND = 10017;

export interface ContactSearchResult {
  pubkey: string;
  profile: ProfileContent | undefined;
}

/**
 * Priority tiers for mention autocomplete results.
 *
 * 0 = priority pubkeys (repo maintainers, parent event participants)
 * 1 = git follows (kind:10017 — git author follow list)
 * 2 = social follows (kind:3 — Nostr contact list)
 * 3 = NIP-50 relay search results
 * 4 = EventStore cache hits (profiles already loaded for other reasons)
 */
type Tier = 0 | 1 | 2 | 3 | 4;

interface ScoredResult {
  pubkey: string;
  profile: ProfileContent | undefined;
  tier: Tier;
}

/**
 * Search for mentionable users with priority ordering:
 *   priority pubkeys → git follows → social follows → NIP-50 relay results → EventStore cache
 *
 * - Profile names are loaded reactively from the EventStore (Applesauce-native).
 * - NIP-50 search is debounced 300ms and fires against relay.ditto.pub.
 * - When query is empty, shows priority pubkeys + git follows + social follows (up to MAX_RESULTS).
 * - Returns [] when no results are available yet.
 *
 * @param query           - The text typed after "@"
 * @param priorityPubkeys - Pubkeys to surface first (maintainers, participants)
 */
export function useContactSearch(
  query: string,
  priorityPubkeys: string[] = [],
): ContactSearchResult[] {
  const myUser = useMyUser();
  const store = useEventStore();

  // ── 1. Git follows (kind:10017) ───────────────────────────────────────────
  const myPubkey = myUser?.pubkey;
  const gitFollowPubkeys =
    use$(() => {
      if (!myPubkey) return undefined;
      return store.replaceable(GIT_AUTHORS_KIND, myPubkey).pipe(
        map((event) => {
          if (!event) return [] as string[];
          return event.tags
            .filter(([t]) => t === "p")
            .map(([, v]) => v)
            .filter((v): v is string => !!v);
        }),
      );
    }, [myPubkey, store]) ?? [];

  // ── 2. Social follows (kind:3) ────────────────────────────────────────────
  const contacts = use$(() => myUser?.contacts$, [myUser?.pubkey]);
  const followPubkeys = useMemo<string[]>(
    () => contacts?.map((u) => u.pubkey) ?? [],
    [contacts],
  );

  // ── 3. Candidate pubkey pool ──────────────────────────────────────────────
  // Union of priority + git follows + social follows, deduplicated, for profile fetching.
  const localPubkeys = useMemo<string[]>(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const pk of [
      ...priorityPubkeys,
      ...gitFollowPubkeys,
      ...followPubkeys,
    ]) {
      if (!seen.has(pk)) {
        seen.add(pk);
        out.push(pk);
      }
    }
    return out;
  }, [priorityPubkeys, gitFollowPubkeys, followPubkeys]);

  const localPubkeyKey = useMemo(
    () => [...localPubkeys].sort().join(","),
    [localPubkeys],
  );

  // ── 4. Fetch profiles for local candidates (lookup relays) ────────────────
  use$(() => {
    if (localPubkeys.length === 0) return undefined;
    const relays = lookupRelays.getValue();
    const filter: Filter = { kinds: [0], authors: localPubkeys };
    return pool
      .subscription(relays, [filter])
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [localPubkeyKey, store]);

  // ── 5. Reactive profile map for local candidates ──────────────────────────
  // Uses the same merge+scan pattern as useProfilesForPubkeys so cached
  // profiles appear immediately and the map grows as network responses arrive.
  const localProfileMap = use$(() => {
    if (localPubkeys.length === 0) return undefined;

    const initial = new Map<string, ProfileContent>();
    for (const pubkey of localPubkeys) {
      const ev = store.getReplaceable(0, pubkey);
      if (ev && isValidProfile(ev)) {
        const content = getProfileContent(ev);
        if (content) initial.set(pubkey, content);
      }
    }

    const streams = localPubkeys.map((pubkey) =>
      store
        .replaceable(0, pubkey)
        .pipe(
          map((ev) =>
            ev && isValidProfile(ev)
              ? ([pubkey, getProfileContent(ev)] as const)
              : null,
          ),
        ),
    );

    return merge(...streams).pipe(
      scan((acc, entry) => {
        if (!entry) return acc;
        const [pubkey, profile] = entry;
        if (!profile) return acc;
        const next = new Map(acc);
        next.set(pubkey, profile);
        return next;
      }, initial),
      startWith(initial),
    );
  }, [localPubkeyKey, store]);

  // ── 6. NIP-50 search (debounced) ──────────────────────────────────────────
  const [nip50Pubkeys, setNip50Pubkeys] = useState<string[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setNip50Pubkeys([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const filter = { kinds: [0], search: trimmed, limit: 10 } as Filter;
        // pool.request completes after EOSE — ideal for one-shot NIP-50 queries
        const events = await new Promise<string[]>((resolve) => {
          const pubkeys: string[] = [];
          pool
            .request([NIP50_RELAY], [filter])
            .pipe(mapEventsToStore(store))
            .subscribe({
              next: (ev) => pubkeys.push(ev.pubkey),
              complete: () => resolve(pubkeys),
              error: () => resolve(pubkeys),
            });
        });
        setNip50Pubkeys(events);
      } catch {
        setNip50Pubkeys([]);
      }
    }, NIP50_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, store]);

  // ── 7. Reactive profiles for NIP-50 results ───────────────────────────────
  // NIP-50 events are already in the store (mapEventsToStore above), so we
  // just need to read them reactively. No extra fetch needed.
  const nip50PubkeyKey = useMemo(
    () => [...nip50Pubkeys].sort().join(","),
    [nip50Pubkeys],
  );

  const nip50ProfileMap = use$(() => {
    if (nip50Pubkeys.length === 0) return undefined;

    const initial = new Map<string, ProfileContent>();
    for (const pubkey of nip50Pubkeys) {
      const ev = store.getReplaceable(0, pubkey);
      if (ev && isValidProfile(ev)) {
        const content = getProfileContent(ev);
        if (content) initial.set(pubkey, content);
      }
    }

    const streams = nip50Pubkeys.map((pubkey) =>
      store
        .replaceable(0, pubkey)
        .pipe(
          map((ev) =>
            ev && isValidProfile(ev)
              ? ([pubkey, getProfileContent(ev)] as const)
              : null,
          ),
        ),
    );

    return merge(...streams).pipe(
      scan((acc, entry) => {
        if (!entry) return acc;
        const [pubkey, profile] = entry;
        if (!profile) return acc;
        const next = new Map(acc);
        next.set(pubkey, profile);
        return next;
      }, initial),
      startWith(initial),
    );
  }, [nip50PubkeyKey, store]);

  // ── 8. Assemble + filter + sort ───────────────────────────────────────────
  return useMemo<ContactSearchResult[]>(() => {
    const lowerQuery = query.trim().toLowerCase();
    const prioritySet = new Set(priorityPubkeys);
    const gitFollowSet = new Set(gitFollowPubkeys);
    const followSet = new Set(followPubkeys);

    // Collect all candidate pubkeys with their tier
    const scored = new Map<string, ScoredResult>();

    const add = (
      pubkey: string,
      profile: ProfileContent | undefined,
      tier: Tier,
    ) => {
      const existing = scored.get(pubkey);
      // Keep the highest-priority (lowest tier number) entry
      if (!existing || tier < existing.tier) {
        scored.set(pubkey, { pubkey, profile, tier });
      }
    };

    // Tier 0: priority pubkeys
    for (const pk of priorityPubkeys) {
      add(pk, localProfileMap?.get(pk), 0);
    }

    // Tier 1: git follows
    for (const pk of gitFollowPubkeys) {
      const tier: Tier = prioritySet.has(pk) ? 0 : 1;
      add(pk, localProfileMap?.get(pk), tier);
    }

    // Tier 2: social follows
    for (const pk of followPubkeys) {
      let tier: Tier = 2;
      if (prioritySet.has(pk)) tier = 0;
      else if (gitFollowSet.has(pk)) tier = 1;
      add(pk, localProfileMap?.get(pk), tier);
    }

    // Tier 3: NIP-50 results
    for (const pk of nip50Pubkeys) {
      let tier: Tier = 3;
      if (prioritySet.has(pk)) tier = 0;
      else if (gitFollowSet.has(pk)) tier = 1;
      else if (followSet.has(pk)) tier = 2;
      const profile = nip50ProfileMap?.get(pk) ?? localProfileMap?.get(pk);
      add(pk, profile, tier);
    }

    // Tier 4: EventStore cache (profiles already loaded for other reasons)
    // Only include when there's a query — avoids flooding the empty-state list
    if (lowerQuery) {
      const cachedEvents = store.getByFilters([{ kinds: [0] }] as Filter[]);
      for (const ev of cachedEvents) {
        if (scored.has(ev.pubkey)) continue;
        if (!isValidProfile(ev)) continue;
        const content = getProfileContent(ev);
        if (!content) continue;
        add(ev.pubkey, content, 4);
      }
    }

    // Filter by query
    const candidates = Array.from(scored.values()).filter(
      ({ profile, tier }) => {
        if (!lowerQuery) {
          // Empty query: only show priority + git follows + social follows
          return tier <= 2;
        }
        if (!profile) {
          // No profile yet — include priority/git-follow/social-follow pubkeys so
          // they appear immediately even before their profile loads
          return tier <= 2;
        }
        const name = (profile.name ?? "").toLowerCase();
        const displayName = (
          profile.display_name ??
          profile.displayName ??
          ""
        ).toLowerCase();
        const nip05 = (profile.nip05 ?? "").toLowerCase();
        return (
          name.includes(lowerQuery) ||
          displayName.includes(lowerQuery) ||
          nip05.includes(lowerQuery)
        );
      },
    );

    // Sort: tier first, then alphabetical within tier
    candidates.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const nameA = (
        a.profile?.display_name ??
        a.profile?.displayName ??
        a.profile?.name ??
        a.pubkey
      ).toLowerCase();
      const nameB = (
        b.profile?.display_name ??
        b.profile?.displayName ??
        b.profile?.name ??
        b.pubkey
      ).toLowerCase();
      return nameA.localeCompare(nameB);
    });

    return candidates.slice(0, MAX_RESULTS).map(({ pubkey, profile }) => ({
      pubkey,
      profile,
    }));
  }, [
    query,
    priorityPubkeys,
    gitFollowPubkeys,
    followPubkeys,
    localProfileMap,
    nip50Pubkeys,
    nip50ProfileMap,
    store,
  ]);
}
