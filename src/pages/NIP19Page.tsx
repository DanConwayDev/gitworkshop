import {
  normalizeToProfilePointer,
  normalizeToEventPointer,
  normalizeToAddressPointer,
} from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { Navigate, useParams } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { eventStore, pool } from "../services/nostr";
import { REPO_KIND, ISSUE_KIND, PATCH_KIND, PR_KIND } from "../lib/nip34";
import { repoToPath, eventIdToNevent } from "../lib/routeUtils";
import UserPage from "./UserPage";
import NotFound from "./NotFound";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { gitIndexRelays } from "../services/settings";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the first `a` tag value from an event (repo coordinate). */
function getRepoCoord(event: NostrEvent): string | undefined {
  return event.tags.find(([t]) => t === "a")?.[1];
}

/**
 * Parse a repo coordinate string (kind:pubkey:dTag) into its parts.
 * Returns undefined if the coord is malformed.
 */
function parseRepoCoord(
  coord: string,
): { kind: number; pubkey: string; dTag: string } | undefined {
  const parts = coord.split(":");
  if (parts.length < 3) return undefined;
  const kind = parseInt(parts[0], 10);
  const pubkey = parts[1];
  const dTag = parts.slice(2).join(":");
  if (isNaN(kind) || !pubkey || !dTag) return undefined;
  return { kind, pubkey, dTag };
}

/**
 * Build a repo path from a repo coordinate, using relay hints from the
 * nevent identifier if available.
 */
function repoCoordToPath(
  coord: string,
  hintRelays: string[],
): string | undefined {
  const parsed = parseRepoCoord(coord);
  if (!parsed) return undefined;
  return repoToPath(parsed.pubkey, parsed.dTag, hintRelays);
}

/** Get the uppercase `E` root tag from a NIP-22 comment (kind 1111). */
function getCommentRootId(event: NostrEvent): string | undefined {
  return event.tags.find(([t]) => t === "E")?.[1];
}

// ---------------------------------------------------------------------------
// Loading spinner
// ---------------------------------------------------------------------------

function LoadingState({ message }: { message: string }) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="h-8 w-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event redirect — resolves an event and redirects to the right page
// ---------------------------------------------------------------------------

function EventRedirect({
  eventId,
  hintRelays,
  commentId,
}: {
  eventId: string;
  hintRelays: string[];
  /** If set, this is a comment permalink — we're resolving the root event. */
  commentId?: string;
}) {
  // Fetch the event from hint relays (if any) and git index relays in parallel.
  // Hint relays are tried first but we don't skip the index — the event may
  // only be on one of them.
  use$(() => {
    const filters = [{ ids: [eventId] }];
    const indexRelays = gitIndexRelays.getValue();
    // Deduplicate: hint relays first, then any index relays not already included
    const allRelays = [
      ...hintRelays,
      ...indexRelays.filter((r) => !hintRelays.includes(r)),
    ];
    return pool
      .subscription(allRelays, filters)
      .pipe(onlyEvents(), mapEventsToStore(eventStore));
  }, [eventId, hintRelays.join(",")]);

  const event = use$(
    () =>
      eventStore.event(eventId) as unknown as Observable<
        NostrEvent | undefined
      >,
    [eventId],
  );

  if (!event) {
    return <LoadingState message={`Fetching event…`} />;
  }

  const kind = event.kind;

  // Issue
  if (kind === ISSUE_KIND) {
    const coord = getRepoCoord(event);
    if (!coord) return <NotFound />;
    const repoPath = repoCoordToPath(coord, hintRelays);
    if (!repoPath) return <NotFound />;
    const nevent = eventIdToNevent(eventId, hintRelays);
    const fragment = commentId ? `#${commentId.slice(0, 15)}` : "";
    return <Navigate to={`${repoPath}/issues/${nevent}${fragment}`} replace />;
  }

  // PR or root patch
  if (kind === PR_KIND || kind === PATCH_KIND) {
    const coord = getRepoCoord(event);
    if (!coord) return <NotFound />;
    const repoPath = repoCoordToPath(coord, hintRelays);
    if (!repoPath) return <NotFound />;
    const nevent = eventIdToNevent(eventId, hintRelays);
    const fragment = commentId ? `#${commentId.slice(0, 15)}` : "";
    return <Navigate to={`${repoPath}/prs/${nevent}${fragment}`} replace />;
  }

  // NIP-22 comment (kind 1111) — resolve the root event
  if (kind === 1111) {
    const rootId = getCommentRootId(event);
    if (!rootId) return <NotFound />;
    // Recurse: resolve the root event, passing this comment's ID as the fragment
    return (
      <EventRedirect
        eventId={rootId}
        hintRelays={hintRelays}
        commentId={event.id}
      />
    );
  }

  return <NotFound />;
}

// ---------------------------------------------------------------------------
// Main NIP19Page
// ---------------------------------------------------------------------------

export function NIP19Page() {
  const { nip19: identifier } = useParams<{ nip19: string }>();

  if (!identifier) return <NotFound />;

  // Handle naddr1 — may point to a repo (kind 30617) or other addressable event
  if (identifier.startsWith("naddr1")) {
    try {
      const decoded = nip19.decode(identifier);
      if (decoded.type === "naddr") {
        const { kind, pubkey, identifier: dTag } = decoded.data;
        if (kind === REPO_KIND) {
          const npub = nip19.npubEncode(pubkey);
          return <Navigate to={`/${npub}/${dTag}`} replace />;
        }
      }
    } catch {
      return <NotFound />;
    }
  }

  // Handle note1 / nevent1 — redirect to the appropriate issue/PR/comment page
  if (identifier.startsWith("note1") || identifier.startsWith("nevent1")) {
    try {
      const decoded = nip19.decode(identifier);
      let eventId: string;
      let hintRelays: string[] = [];

      if (decoded.type === "note") {
        eventId = decoded.data;
      } else if (decoded.type === "nevent") {
        eventId = decoded.data.id;
        hintRelays = decoded.data.relays ?? [];
      } else {
        return <NotFound />;
      }

      return <EventRedirect eventId={eventId} hintRelays={hintRelays} />;
    } catch {
      return <NotFound />;
    }
  }

  // Get the user pointer from the identifier
  const user = normalizeToProfilePointer(identifier);

  // Attempt to get the event pointer
  const pointer =
    normalizeToAddressPointer(identifier) ||
    normalizeToEventPointer(identifier);

  // Load the event from the relays
  const event = use$(
    () => (pointer ? eventStore.event(pointer) : undefined),
    [JSON.stringify(pointer)],
  );

  if (identifier.startsWith("npub1") || identifier.startsWith("nprofile1")) {
    if (!user) return <NotFound />;

    return <UserPage pubkey={user.pubkey} />;
  } else if (pointer) {
    // AI agent should implement event loading view here
    if (!event) return <div>Loading event...</div>;

    // AI agent should implement event view here based on event kind
    switch (event.kind) {
      case 1:
        return <div>Note placeholder</div>;
      default:
        return <div>Unknown event type</div>;
    }
  } else {
    return <NotFound />;
  }
}
