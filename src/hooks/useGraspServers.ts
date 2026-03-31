/**
 * useGraspServers — resolve the user's preferred Grasp servers.
 *
 * Reads the user's kind:10317 (User Grasp List) event from the EventStore.
 * The persistent subscription in userIdentitySubscription.ts keeps this
 * event fresh from the user's outbox + index relays for the session lifetime,
 * so this hook only needs to read from the store — no relay subscription.
 *
 * Falls back to DEFAULT_GRASP_SERVERS when the user has no grasp list
 * published.
 *
 * Returns an array of GraspServer objects with both the WebSocket URL
 * and the bare domain.
 */

import { useMemo } from "react";
import { map } from "rxjs/operators";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { DEFAULT_GRASP_SERVERS } from "@/services/settings";
import type { NostrEvent } from "nostr-tools";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NIP-34 User Grasp List kind */
const GRASP_LIST_KIND = 10317;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A resolved Grasp server. */
export interface GraspServer {
  /** WebSocket URL, e.g. "wss://relay.ngit.dev" */
  wsUrl: string;
  /** Bare domain, e.g. "relay.ngit.dev" */
  domain: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract Grasp server domains from a kind:10317 event.
 * Each `g` tag contains a WebSocket URL; we extract the hostname.
 */
function parseGraspListEvent(event: NostrEvent): GraspServer[] {
  const servers: GraspServer[] = [];
  const seen = new Set<string>();

  for (const tag of event.tags) {
    if (tag[0] !== "g" || !tag[1]) continue;

    const wsUrl = tag[1];
    try {
      // Parse the WebSocket URL to extract the domain
      const url = new URL(wsUrl);
      const domain = url.hostname;
      if (!seen.has(domain)) {
        seen.add(domain);
        servers.push({ wsUrl, domain });
      }
    } catch {
      // If the tag value is a bare domain (no protocol), handle that too
      const domain = wsUrl.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
      if (domain && !seen.has(domain)) {
        seen.add(domain);
        servers.push({ wsUrl: `wss://${domain}`, domain });
      }
    }
  }

  return servers;
}

/** Convert DEFAULT_GRASP_SERVERS domains to GraspServer objects. */
function defaultServers(): GraspServer[] {
  return DEFAULT_GRASP_SERVERS.map((domain) => ({
    wsUrl: `wss://${domain}`,
    domain,
  }));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Resolve the user's Grasp server list from the EventStore.
 *
 * The persistent subscription (userIdentitySubscription.ts) keeps kind:10317
 * fresh in the store, so this hook only reads — no relay subscription needed.
 *
 * @param pubkey - The user's hex pubkey (pass undefined when not logged in)
 * @returns Object with:
 *   - `servers`: The resolved GraspServer array (from kind:10317 or defaults)
 *   - `isFromUserList`: Whether the servers came from the user's published list
 *   - `isLoading`: Whether we're still waiting for the store to emit
 */
export function useGraspServers(pubkey: string | undefined): {
  servers: GraspServer[];
  isFromUserList: boolean;
  isLoading: boolean;
} {
  const store = useEventStore();

  // Read the kind:10317 event from the store reactively.
  // The persistent subscription in userIdentitySubscription.ts ensures this
  // event is kept up-to-date from outbox + index relays.
  const graspListEvent = use$(() => {
    if (!pubkey) return undefined;
    return store
      .replaceable(GRASP_LIST_KIND, pubkey)
      .pipe(map((event) => event ?? null));
  }, [pubkey, store]);

  return useMemo(() => {
    // Not logged in — return defaults
    if (!pubkey) {
      return {
        servers: defaultServers(),
        isFromUserList: false,
        isLoading: false,
      };
    }

    // Still loading (undefined = observable hasn't emitted yet)
    if (graspListEvent === undefined) {
      return {
        servers: defaultServers(),
        isFromUserList: false,
        isLoading: true,
      };
    }

    // No grasp list event found (null = emitted empty)
    if (graspListEvent === null) {
      return {
        servers: defaultServers(),
        isFromUserList: false,
        isLoading: false,
      };
    }

    // Parse the event
    const parsed = parseGraspListEvent(graspListEvent);
    if (parsed.length === 0) {
      return {
        servers: defaultServers(),
        isFromUserList: false,
        isLoading: false,
      };
    }

    return { servers: parsed, isFromUserList: true, isLoading: false };
  }, [pubkey, graspListEvent]);
}
