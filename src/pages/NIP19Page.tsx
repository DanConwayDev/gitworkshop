import {
  normalizeToProfilePointer,
  normalizeToEventPointer,
  normalizeToAddressPointer,
} from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { eventStore, pool } from "../services/nostr";
import { REPO_KIND, ISSUE_KIND, PATCH_KIND, PR_KIND } from "../lib/nip34";
import { eventIdToNevent, isNip05, standardizeNip05 } from "../lib/routeUtils";
import { useRepoPath } from "../hooks/useRepoPath";
import UserPage from "./UserPage";
import NotFound from "./NotFound";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { resilientSubscription } from "../lib/resilientSubscription";
import { gitIndexRelays } from "../services/settings";
import { useDnsIdentity } from "../hooks/useDnsIdentity";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import { getReplaceableIdentifier } from "applesauce-core/helpers";

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
 * Redirect component that resolves a repo coordinate to a path (with NIP-05
 * preference) and navigates to the target sub-path.
 *
 * Using a component lets us call the useRepoPath hook after the event is loaded.
 */
function RepoCoordRedirect({
  coord,
  hintRelays,
  subPath,
  stargazerPubkey,
}: {
  coord: string;
  hintRelays: string[];
  /** Path segment appended after the repo root, e.g. "/issues/nevent1..." */
  subPath: string;
  /** When set, appends ?stargazer=<pubkey> to open the stargazers popover. */
  stargazerPubkey?: string;
}) {
  const parsed = parseRepoCoord(coord);
  if (!parsed) return <NotFound />;
  return (
    <RepoPathRedirect
      pubkey={parsed.pubkey}
      repoId={parsed.dTag}
      relays={hintRelays}
      subPath={subPath}
      stargazerPubkey={stargazerPubkey}
    />
  );
}

/**
 * Inner redirect: calls useRepoPath (which may prefer NIP-05) then navigates.
 *
 * Forwards the current location's search params and hash to the destination
 * so that ?unread=... and #anchor fragments survive the redirect chain.
 * The ?stargazer= param takes precedence over any forwarded search string.
 */
function RepoPathRedirect({
  pubkey,
  repoId,
  relays,
  subPath,
  stargazerPubkey,
}: {
  pubkey: string;
  repoId: string;
  relays: string[];
  subPath: string;
  /** When set, appends ?stargazer=<pubkey> to open the stargazers popover. */
  stargazerPubkey?: string;
}) {
  const repoPath = useRepoPath(pubkey, repoId, relays);
  const location = useLocation();

  // Build the search string: stargazer takes precedence; otherwise forward
  // whatever search params arrived on the current URL (e.g. ?unread=...).
  let search = "";
  if (stargazerPubkey) {
    search = `?stargazer=${stargazerPubkey}`;
  } else if (location.search) {
    search = location.search;
  }

  // Forward the hash fragment too (e.g. #<anchorId> for comment permalinks).
  // subPath may already contain a fragment (e.g. "/issues/nevent1...#abc123");
  // only append location.hash if subPath doesn't already have one.
  const subPathHasHash = subPath.includes("#");
  const hash = !subPathHasHash && location.hash ? location.hash : "";

  return <Navigate to={`${repoPath}${subPath}${search}${hash}`} replace />;
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
        <div className="h-8 w-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto" />
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
  stargazerPubkey,
}: {
  eventId: string;
  hintRelays: string[];
  /** If set, this is a comment permalink — we're resolving the root event. */
  commentId?: string;
  /** If set, this is a star reaction permalink — open the stargazers popover. */
  stargazerPubkey?: string;
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
    return resilientSubscription(pool, allRelays, filters, {
      paginate: false,
    }).pipe(onlyEvents(), mapEventsToStore(eventStore));
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

  // Repo announcement (kind 30617) — redirect to the repo landing page.
  // When arriving via a star reaction permalink, append ?stargazer=<pubkey>
  // so the StarButton can open the popover and highlight that user.
  if (kind === REPO_KIND) {
    const dTag = getReplaceableIdentifier(event);
    if (!dTag) return <NotFound />;
    const coord = `${REPO_KIND}:${event.pubkey}:${dTag}`;
    return (
      <RepoCoordRedirect
        coord={coord}
        hintRelays={hintRelays}
        subPath=""
        stargazerPubkey={stargazerPubkey}
      />
    );
  }

  // Issue
  if (kind === ISSUE_KIND) {
    const coord = getRepoCoord(event);
    if (!coord) return <NotFound />;
    const nevent = eventIdToNevent(eventId, hintRelays);
    const fragment = commentId ? `#${commentId.slice(0, 15)}` : "";
    return (
      <RepoCoordRedirect
        coord={coord}
        hintRelays={hintRelays}
        subPath={`/issues/${nevent}${fragment}`}
      />
    );
  }

  // PR or root patch
  if (kind === PR_KIND || kind === PATCH_KIND) {
    const coord = getRepoCoord(event);
    if (!coord) return <NotFound />;
    const nevent = eventIdToNevent(eventId, hintRelays);
    const fragment = commentId ? `#${commentId.slice(0, 15)}` : "";
    return (
      <RepoCoordRedirect
        coord={coord}
        hintRelays={hintRelays}
        subPath={`/prs/${nevent}${fragment}`}
      />
    );
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

  // NIP-25 reaction (kind 7) — resolve the target event (last `e` tag per spec)
  if (kind === 7) {
    const eTags = event.tags.filter(([t]) => t === "e");
    const lastETag = eTags[eTags.length - 1];
    const targetId = lastETag?.[1];
    const targetRelay = lastETag?.[2];
    if (!targetId) return <NotFound />;
    const relays = targetRelay
      ? [targetRelay, ...hintRelays.filter((r) => r !== targetRelay)]
      : hintRelays;
    // Use the `k` tag to determine what was reacted to.
    const targetKind = parseInt(
      event.tags.find(([t]) => t === "k")?.[1] ?? "",
      10,
    );
    // Star on a repo announcement — pass the reactor's pubkey so the repo
    // page can open the stargazers popover and highlight them.
    if (targetKind === REPO_KIND) {
      return (
        <EventRedirect
          eventId={targetId}
          hintRelays={relays}
          stargazerPubkey={event.pubkey}
        />
      );
    }
    // Reaction on a comment — anchor to that comment in the thread.
    const resolvedCommentId = targetKind === 1111 ? targetId : undefined;
    return (
      <EventRedirect
        eventId={targetId}
        hintRelays={relays}
        commentId={resolvedCommentId}
      />
    );
  }

  return <NotFound />;
}

// ---------------------------------------------------------------------------
// NIP-05 user page — resolves identity then renders UserPage
// ---------------------------------------------------------------------------

function Nip05UserPage({ nip05 }: { nip05: string }) {
  const identity = useDnsIdentity(nip05);

  if (identity.status === "loading") {
    return <LoadingState message={`Resolving ${nip05}…`} />;
  }

  if (identity.status === "not-found" || identity.status === "error") {
    return <NotFound />;
  }

  return <UserPage pubkey={identity.pubkey} />;
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
        const { kind, pubkey, identifier: dTag, relays } = decoded.data;
        if (kind === REPO_KIND) {
          return (
            <RepoPathRedirect
              pubkey={pubkey}
              repoId={dTag}
              relays={relays ?? []}
              subPath=""
            />
          );
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
  } else if (isNip05(identifier)) {
    // Bare domain (danconwaydev.com) or _@domain.com — resolve to user page
    return <Nip05UserPage nip05={standardizeNip05(identifier)} />;
  } else {
    return <NotFound />;
  }
}
