import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { castTimelineStream } from "applesauce-common/observable";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import { pool } from "@/services/nostr";
import { REPO_KIND } from "@/lib/nip34";
import { gitIndexRelays } from "@/services/settings";
import { Repository } from "@/casts/Repository";
import type { Filter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";

const filters: Filter[] = [{ kinds: [REPO_KIND], limit: 200 }];

/**
 * Fetch all repository announcements from the ngit relay.
 */
export function useRepositories(): Repository[] | undefined {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  // Fetch from relay
  use$(
    () =>
      pool
        .subscription(gitIndexRelays.getValue(), filters)
        .pipe(onlyEvents(), mapEventsToStore(store)),
    [store],
  );

  // Subscribe to store timeline, cast to Repository instances
  return use$(
    () =>
      store
        .timeline(filters)
        .pipe(
          castTimelineStream(Repository, castStore),
        ) as unknown as Observable<Repository[]>,
    [store],
  );
}

/**
 * Fetch a single repository by pubkey and d-tag.
 */
export function useRepository(
  pubkey: string | undefined,
  dTag: string | undefined,
): Repository | undefined {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;

  const repoFilterKey = JSON.stringify({ pubkey, dTag });

  // Fetch from relay
  use$(() => {
    if (!pubkey || !dTag) return undefined;
    const repoFilters: Filter[] = [
      { kinds: [REPO_KIND], authors: [pubkey], "#d": [dTag] } as Filter,
    ];
    return pool
      .subscription(gitIndexRelays.getValue(), repoFilters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [repoFilterKey, store]);

  // Subscribe to store, cast to Repository
  const repos = use$(() => {
    if (!pubkey || !dTag) return undefined;
    const repoFilters: Filter[] = [
      { kinds: [REPO_KIND], authors: [pubkey], "#d": [dTag] } as Filter,
    ];
    return store
      .timeline(repoFilters)
      .pipe(castTimelineStream(Repository, castStore)) as unknown as Observable<
      Repository[]
    >;
  }, [repoFilterKey, store]);

  return repos?.[0];
}
