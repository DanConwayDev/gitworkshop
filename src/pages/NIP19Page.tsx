import {
  normalizeToAddressPointer,
  normalizeToEventPointer,
  normalizeToProfilePointer
} from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { useParams } from "react-router-dom";
import { eventStore } from "../services/nostr";
import NotFound from "./NotFound";

export function NIP19Page() {
  const { nip19: identifier } = useParams<{ nip19: string }>();

  if (!identifier) return <NotFound />;

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

    // AI agent should implement profile view here
    return <div>Profile placeholder</div>;
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
