import { useParams } from "react-router-dom";
import { parseRelayUrl } from "@/lib/routeUtils";
import RepositoriesPage from "./RepositoriesPage";
import NotFound from "./NotFound";

/**
 * Browse repositories on a specific relay.
 *
 * Route: /relay/:relaySegment
 *
 * The segment uses the same encoding as relay hints in repo URLs:
 *   - wss:// is stripped:   relay.ngit.dev
 *   - ws:// is URL-encoded: ws%3A%2F%2Frelay.example.com
 *
 * Examples:
 *   /relay/relay.ngit.dev          → wss://relay.ngit.dev
 *   /relay/relay.damus.io          → wss://relay.damus.io
 *   /relay/ws%3A%2F%2Flocalhost    → ws://localhost
 */
export default function RelayPage() {
  const { relaySegment } = useParams<{ relaySegment: string }>();

  if (!relaySegment) return <NotFound />;

  const relayUrl = parseRelayUrl(relaySegment);

  if (!relayUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold">Invalid relay URL</p>
          <p className="text-muted-foreground text-sm">
            &ldquo;{relaySegment}&rdquo; could not be parsed as a relay address.
          </p>
        </div>
      </div>
    );
  }

  // Extract a human-readable label: strip the scheme for display
  const relayLabel = relayUrl.replace(/^wss?:\/\//, "").replace(/\/$/, "");

  return (
    <RepositoriesPage relayOverride={[relayUrl]} relayLabel={relayLabel} />
  );
}
