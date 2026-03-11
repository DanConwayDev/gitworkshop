import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { pool } from "@/services/nostr";
import { REPO_KIND, NGIT_RELAYS } from "@/lib/nip34";
import { parseRepository, type RepositoryData } from "@/casts/Repository";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

/**
 * Fetch all repository announcements from the ngit relay.
 */
export function useRepositories(): RepositoryData[] | undefined {
  const store = useEventStore();

  const filters: Filter[] = useMemo(
    () => [{ kinds: [REPO_KIND], limit: 200 }],
    [],
  );
  const filterKey = JSON.stringify(filters);

  // Fetch from relay
  use$(
    () =>
      pool
        .req(NGIT_RELAYS, filters)
        .pipe(onlyEvents(), mapEventsToStore(store)),
    [filterKey, store],
  );

  // Subscribe to store timeline
  const events = use$(
    () => store.timeline(filters) as unknown as Observable<NostrEvent[]>,
    [filterKey, store],
  );

  return useMemo(() => {
    if (!events) return undefined;
    return events
      .map(parseRepository)
      .filter((r): r is RepositoryData => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [events]);
}

/**
 * Fetch a single repository by pubkey and d-tag.
 */
export function useRepository(
  pubkey: string | undefined,
  dTag: string | undefined,
): RepositoryData | undefined {
  const store = useEventStore();

  const filters: Filter[] | undefined = useMemo(() => {
    if (!pubkey || !dTag) return undefined;
    return [{ kinds: [REPO_KIND], authors: [pubkey], "#d": [dTag] } as Filter];
  }, [pubkey, dTag]);

  const filterKey = JSON.stringify(filters);

  // Fetch from relay
  use$(() => {
    if (!filters) return undefined;
    return pool
      .req(NGIT_RELAYS, filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [filterKey, store]);

  // Subscribe to store
  const events = use$(() => {
    if (!filters) return undefined;
    return store.timeline(filters) as unknown as Observable<NostrEvent[]>;
  }, [filterKey, store]);

  return useMemo(() => {
    if (!events || events.length === 0) return undefined;
    return parseRepository(events[0]) ?? undefined;
  }, [events]);
}
