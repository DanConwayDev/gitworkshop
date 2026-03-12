import {
  normalizeToAddressPointer,
  normalizeToEventPointer,
  normalizeToProfilePointer,
} from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { Navigate, useParams } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { eventStore } from "../services/nostr";
import { REPO_KIND } from "../lib/nip34";
import UserPage from "./UserPage";
import RepoPage from "./RepoPage";
import NotFound from "./NotFound";

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
          const npub = nip19.npubEncode(pubkey);
          // If the URL has no relay hints just redirect to the plain route.
          // If it does, render RepoPage directly so we can pass the hints as a
          // prop without losing them in the redirect.
          if (!relays || relays.length === 0) {
            return <Navigate to={`/${npub}/${dTag}`} replace />;
          }
          return <RepoPage relayHints={relays} />;
        }
      }
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
