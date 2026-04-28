import {
  normalizeToProfilePointer,
  normalizeToEventPointer,
  normalizeToAddressPointer,
} from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { useEffect, useMemo, useState } from "react";
import { of } from "rxjs";
import { eventStore } from "../services/nostr";
import { REPO_KIND, ISSUE_KIND, PATCH_KIND, PR_KIND } from "../lib/nip34";
import {
  eventIdToNevent,
  isNip05,
  isHexPubkey,
  standardizeNip05,
} from "../lib/routeUtils";
import { useRepoPath } from "../hooks/useRepoPath";
import UserPage from "./UserPage";
import NotFound from "./NotFound";
import { UnsupportedEventPage } from "./UnsupportedEventPage";
import { EventSearchStatus } from "@/components/EventSearchStatus";
import {
  useEventSearch,
  type RelayGroupSpec,
  type SearchTarget,
} from "@/hooks/useEventSearch";
import { gitIndexRelays, fallbackRelays } from "../services/settings";
import { useDnsIdentity } from "../hooks/useDnsIdentity";
import type { NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import { getReplaceableIdentifier } from "applesauce-core/helpers";
import { getNip10References } from "applesauce-common/helpers";

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

/**
 * Get the NIP-10 thread root event ID from any event that uses `e` tags for
 * threading (kind:1 replies, legacy NIP-34 replies, etc.).
 *
 * Prefers the marked `root` tag; falls back to the first positional `e` tag
 * for older events that don't use markers.
 */
function getNip10RootId(event: NostrEvent): string | undefined {
  const refs = getNip10References(event);
  // Marked root takes priority
  if (refs.root?.e?.id) return refs.root.e.id;
  // Positional fallback: first e tag is the root when there are multiple
  const eTags = event.tags.filter(([t]) => t === "e");
  if (eTags.length >= 2) return eTags[0]?.[1];
  // Single e tag — this event is a direct reply to that event
  if (eTags.length === 1) return eTags[0]?.[1];
  return undefined;
}

// ---------------------------------------------------------------------------
// Loading spinner
// ---------------------------------------------------------------------------

function LoadingState({ message }: { message: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setVisible(true), 1000);
    return () => clearTimeout(id);
  }, []);
  return (
    <div
      className={`min-h-[50vh] flex items-center justify-center transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`}
    >
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
  authorPubkey,
  commentId,
  stargazerPubkey,
  originalEvent,
}: {
  eventId: string;
  hintRelays: string[];
  /** Author pubkey if known (from nevent). Enables vanish check. */
  authorPubkey?: string;
  /** If set, this is a comment permalink — we're resolving the root event. */
  commentId?: string;
  /** If set, this is a star reaction permalink — open the stargazers popover. */
  stargazerPubkey?: string;
  /**
   * The first event in a NIP-10 root-following chain. When we follow e-tags
   * and the chain terminates at an unsupported (non-git) event, we show an
   * UnsupportedEventPage for this original event rather than the final root,
   * because that is what the user actually navigated to.
   */
  originalEvent?: NostrEvent;
}) {
  // Build relay groups: hint relays first, then git index, then extra relays
  const hintsKey = hintRelays.join(",");
  const searchGroups = useMemo<RelayGroupSpec[]>(() => {
    const groups: RelayGroupSpec[] = [];
    if (hintRelays.length > 0) {
      groups.push({ label: "hint relays", relays$: of(hintRelays) });
    }
    groups.push({ label: "git index", relays$: gitIndexRelays });
    groups.push({
      label: "fallback relays",
      relays$: fallbackRelays,
      deferred: true,
    });
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintsKey]);

  const searchTarget = useMemo<SearchTarget>(
    () => ({ type: "event", id: eventId, authorPubkey }),
    [eventId, authorPubkey],
  );

  const search = useEventSearch(searchTarget, searchGroups);

  // Also subscribe to the store for the event (it may already be there or
  // arrive via the search)
  const event = use$(
    () =>
      eventStore.event(eventId) as unknown as Observable<
        NostrEvent | undefined
      >,
    [eventId],
  );

  // Delay showing the search status page so the plain spinner shows first for
  // up to 2s. Skip the delay if the search has already concluded (not found /
  // deleted / vanished) so we never sit on the spinner after the answer is known.
  const [searchDelayElapsed, setSearchDelayElapsed] = useState(false);
  useEffect(() => {
    setSearchDelayElapsed(false);
    const timer = setTimeout(() => setSearchDelayElapsed(true), 2000);
    return () => clearTimeout(timer);
  }, [eventId]);

  if (!event) {
    const searchConcluded =
      search && (search.concludedNotFound || search.deleted || search.vanished);
    if (search && (searchDelayElapsed || searchConcluded) && !search.found) {
      return (
        <EventSearchStatus
          search={search}
          eventId={eventId}
          itemLabel="Event"
        />
      );
    }
    return <LoadingState message="Fetching event…" />;
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

  // For any other kind, check if this event is threaded (NIP-10 `e` tags)
  // and the root is a supported git kind. If so, redirect to the root's page
  // with this event's ID as a fragment anchor (permalink to the comment).
  // Preserve commentId if already set (we may be resolving an intermediate
  // event in a chain — the original linked event is what we want to anchor to).
  //
  // We also carry the first event in the chain as `originalEvent` so that if
  // the chain terminates at a non-git (unsupported) event we can show an
  // UnsupportedEventPage for the event the user actually linked to, not the
  // unrelated social-media root.
  const nip10RootId = getNip10RootId(event);
  if (nip10RootId && nip10RootId !== eventId) {
    return (
      <EventRedirect
        eventId={nip10RootId}
        hintRelays={hintRelays}
        commentId={commentId ?? event.id}
        originalEvent={originalEvent ?? event}
      />
    );
  }

  // No thread root found or this IS the root.
  // If we got here by following a NIP-10 chain from an unsupported event,
  // show UnsupportedEventPage for the original event (the one the user linked
  // to), not the final root.  Otherwise show the current event.
  const pageEvent = originalEvent ?? event;
  return <UnsupportedEventPage event={pageEvent} relayHints={hintRelays} />;
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
      let authorPubkey: string | undefined;

      if (decoded.type === "note") {
        eventId = decoded.data;
      } else if (decoded.type === "nevent") {
        eventId = decoded.data.id;
        hintRelays = decoded.data.relays ?? [];
        authorPubkey = decoded.data.author;
      } else {
        return <NotFound />;
      }

      return (
        <EventRedirect
          eventId={eventId}
          hintRelays={hintRelays}
          authorPubkey={authorPubkey}
        />
      );
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
  } else if (isHexPubkey(identifier)) {
    return <UserPage pubkey={identifier.toLowerCase()} />;
  } else if (pointer) {
    if (!event) return <LoadingState message="Fetching event…" />;

    // For any event kind this app doesn't have a dedicated page for, show a
    // preview with a link to njump.me so users aren't left with a blank 404.
    const hintRelays = "relays" in pointer ? (pointer.relays ?? []) : [];
    return <UnsupportedEventPage event={event} relayHints={hintRelays} />;
  } else if (isNip05(identifier)) {
    // Bare domain (danconwaydev.com) or _@domain.com — resolve to user page
    return <Nip05UserPage nip05={standardizeNip05(identifier)} />;
  } else {
    return <NotFound />;
  }
}
