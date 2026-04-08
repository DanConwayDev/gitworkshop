import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { pool } from "@/services/nostr";
import { resilientSubscription } from "@/lib/resilientSubscription";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";

/**
 * Subscribe to a raw event feed from relays.
 *
 * Unlike `useTimeline`, this hook returns raw `NostrEvent[]` without casting
 * to Note objects. Use this for non-kind-1 events (issues, patches, articles,
 * marketplace listings, etc.) where the Note cast is inappropriate or wasteful.
 *
 * The `mapEventsToTimeline()` operator returns `unknown` from TypeScript's
 * perspective — the cast to `NostrEvent[]` is intentional and safe.
 *
 * For tag filters that aren't in the base Filter type (e.g. `#a`, `#E`),
 * cast the filter object:
 *   const f = { kinds: [1621], "#a": [coord] } as Filter;
 *
 * @param relays - Array of relay URLs to query
 * @param filters - Nostr filter objects (cast as Filter for tag filters)
 * @returns Array of raw NostrEvents, or undefined while loading
 *
 * @example
 * ```tsx
 * import { useEvents } from '@/hooks/useEvents';
 * import type { Filter } from 'applesauce-core/helpers';
 *
 * // Non-kind-1 feed (e.g. NIP-34 git issues)
 * function IssueList({ repoCoord }: { repoCoord: string }) {
 *   const filter = { kinds: [1621], "#a": [repoCoord] } as Filter;
 *   const events = useEvents(['wss://relay.damus.io'], [filter]);
 *
 *   if (!events) return <Skeleton />;
 *
 *   return (
 *     <ul>
 *       {events.map(e => (
 *         <li key={e.id}>{e.tags.find(([t]) => t === 'subject')?.[1]}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useEvents(
  relays: string[],
  filters: Filter[],
): NostrEvent[] | undefined {
  const store = useEventStore();

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);
  const relayKey = useMemo(() => JSON.stringify(relays), [relays]);

  const events = use$(
    () =>
      resilientSubscription(pool, relays, filters, { paginate: true }).pipe(
        onlyEvents(),
        mapEventsToStore(store),
        mapEventsToTimeline(),
      ) as unknown as import("rxjs").Observable<NostrEvent[]>,
    [relayKey, filterKey, store],
  );

  return events ?? undefined;
}

/**
 * Subscribe to a local raw event feed from the EventStore (no relay queries).
 *
 * @param filters - Nostr filter objects
 * @returns Array of raw NostrEvents
 *
 * @example
 * ```tsx
 * import { useLocalEvents } from '@/hooks/useEvents';
 *
 * function CachedIssues({ repoCoord }: { repoCoord: string }) {
 *   const filter = { kinds: [1621], "#a": [repoCoord] } as Filter;
 *   const events = useLocalEvents([filter]);
 *   return events?.map(e => <div key={e.id}>{e.content}</div>);
 * }
 * ```
 */
export function useLocalEvents(filters: Filter[]): NostrEvent[] | undefined {
  const store = useEventStore();

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const events = use$(
    () =>
      store.timeline(filters) as unknown as import("rxjs").Observable<
        NostrEvent[]
      >,
    [filterKey, store],
  );

  return events ?? undefined;
}
