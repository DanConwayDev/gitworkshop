import { useMemo } from "react";
import { use$ } from "./use$";
import { useEventStore } from "./useEventStore";
import { Note, EventCast } from "applesauce-common/casts";
import { castTimelineStream } from "applesauce-common/observable";
import { mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { pool } from "@/services/nostr";
import type { Filter, NostrEvent } from "applesauce-core/helpers";
import type { CastConstructor } from "applesauce-common/casts";

/**
 * Subscribe to a timeline of events from relays.
 * Events are cast using the provided cast class (defaults to Note for kind:1 feeds).
 * Events that fail to cast (e.g. wrong kind) are silently dropped.
 *
 * @param relays - Array of relay URLs to query
 * @param filters - Nostr filter objects
 * @param castClass - Cast class to use (defaults to Note)
 * @returns Array of cast instances, or undefined while loading
 *
 * @example
 * ```tsx
 * import { useTimeline } from '@/hooks/useTimeline';
 * import { Note, Article } from 'applesauce-common/casts';
 *
 * // Default: kind:1 text notes
 * function Timeline() {
 *   const notes = useTimeline(
 *     ['wss://relay.damus.io'],
 *     [{ kinds: [1], limit: 20 }]
 *   );
 *
 *   if (!notes) return <Loading />;
 *   return notes.map(note => <NoteCard key={note.id} note={note} />);
 * }
 *
 * // Custom cast: long-form articles
 * function ArticleFeed() {
 *   const articles = useTimeline(
 *     ['wss://relay.damus.io'],
 *     [{ kinds: [30023], limit: 20 }],
 *     Article,
 *   );
 *
 *   if (!articles) return <Loading />;
 *   return articles.map(a => <ArticleCard key={a.id} article={a} />);
 * }
 * ```
 */
export function useTimeline<C extends EventCast<NostrEvent> = Note>(
  relays: string[],
  filters: Filter[],
  castClass: CastConstructor<C> = Note as unknown as CastConstructor<C>,
): C[] | undefined {
  const store = useEventStore();

  // Memoize the filters to prevent unnecessary re-subscriptions
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);
  const relayKey = useMemo(() => JSON.stringify(relays), [relays]);

  const notes = use$(
    () =>
      pool.subscription(relays, filters).pipe(
        onlyEvents(), // Filter out EOSE and other relay messages
        mapEventsToStore(store), // Add events to store and deduplicate
        mapEventsToTimeline(), // Collect events into an array
        // @ts-expect-error - Cast type compatibility with EventStore
        castTimelineStream(castClass, store),
      ),
    [relayKey, filterKey, store, castClass],
  );

  return notes ?? undefined;
}

/**
 * Subscribe to a local timeline from the EventStore (no relay queries).
 * Events are cast using the provided cast class (defaults to Note for kind:1 feeds).
 * Events that fail to cast (e.g. wrong kind) are silently dropped.
 *
 * @param filters - Nostr filter objects
 * @param castClass - Cast class to use (defaults to Note)
 * @returns Array of cast instances
 *
 * @example
 * ```tsx
 * import { useLocalTimeline } from '@/hooks/useTimeline';
 * import { Article } from 'applesauce-common/casts';
 *
 * function CachedTimeline() {
 *   const notes = useLocalTimeline([{ kinds: [1], limit: 20 }]);
 *   return notes?.map(note => <NoteCard key={note.id} note={note} />);
 * }
 *
 * function CachedArticles() {
 *   const articles = useLocalTimeline([{ kinds: [30023] }], Article);
 *   return articles?.map(a => <ArticleCard key={a.id} article={a} />);
 * }
 * ```
 */
export function useLocalTimeline<C extends EventCast<NostrEvent> = Note>(
  filters: Filter[],
  castClass: CastConstructor<C> = Note as unknown as CastConstructor<C>,
): C[] | undefined {
  const store = useEventStore();

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const notes = use$(
    () =>
      store.timeline(filters).pipe(
        // @ts-expect-error - Cast type compatibility with EventStore
        castTimelineStream(castClass, store),
      ),
    [filterKey, store, castClass],
  );

  return notes ?? undefined;
}
