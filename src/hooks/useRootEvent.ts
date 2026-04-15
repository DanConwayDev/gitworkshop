/**
 * useRootEvent — fetch and subscribe to a notification's root event.
 *
 * Shared between NotificationsPage and the Dashboard compact panel.
 * Social notification rootIds are synthetic strings (not 64-char hex event
 * IDs) — this hook returns undefined for those without creating a dead
 * timeline subscription.
 */

import { useEffect } from "react";
import { use$ } from "@/hooks/use$";
import { eventStore, eventLoader } from "@/services/nostr";

export function useRootEvent(rootId: string) {
  // A valid Nostr event ID is exactly 64 hex chars.
  const isEventId = rootId.length === 64;

  const rootEvents = use$(() => {
    if (!isEventId) return undefined;
    return eventStore.timeline([{ ids: [rootId] }]);
  }, [rootId, isEventId]);

  // Fire the loader once if the root event isn't in the store yet.
  useEffect(() => {
    if (isEventId && (!rootEvents || rootEvents.length === 0)) {
      eventLoader({ id: rootId }).subscribe();
    }
  }, [rootId, isEventId, rootEvents]);

  return rootEvents?.[0];
}
